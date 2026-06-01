import { promises as fsp } from 'fs'
import { join } from 'path'
import type { Db } from '../infra/Db'
import { NodeFsAdapter } from '@core/NodeFsAdapter'
import { SafetyGuard } from '@core/SafetyGuard'
import { coldStorageRoot } from '@core/coldPath'
import { getActiveProfile } from '@core/platform'
import { readManifest, writeManifest } from '../infra/manifest'
import { getVolumeId } from './platformShell'
import { AppError } from '@shared/errors'

export interface BackupInfo {
  path: string
  cold_root: string
  volume_serial: string | null
  cold_period_days: number
}

export interface ValidateResult {
  ok: boolean
  error?: string
  volume_serial?: string | null
}

/** 备份盘设置与校验（PRD §5.3）+ 冷藏区目录初始化（PRD §10.3）。 */
export class BackupService {
  private fs = new NodeFsAdapter()

  constructor(private db: Db) {}

  get(): BackupInfo | null {
    const path = this.db.getSetting<string>('backup_drive_path', '')
    if (!path) return null
    return {
      path,
      cold_root: this.db.getSetting<string>('cold_storage_root', coldStorageRoot(getActiveProfile().path, path)),
      volume_serial: this.db.getSetting<string | null>('backup_volume_serial', null),
      cold_period_days: this.db.getSetting<number>('default_cold_period_days', 90)
    }
  }

  /** 校验候选备份目录：非 C 盘、非系统目录、存在、可写。 */
  async validate(path: string): Promise<ValidateResult> {
    const guard = new SafetyGuard(this.fs, { excludedDirs: [], systemDrive: 'C:' })
    try {
      guard.assertValidBackupTarget(path)
    } catch (e) {
      return { ok: false, error: e instanceof AppError ? e.message : String(e) }
    }
    if (!(await this.fs.exists(path))) {
      return { ok: false, error: '所选目录不存在' }
    }
    // 可写性探测：写入再删除临时文件
    const probe = join(path, `.cdc_write_test_${Date.now()}`)
    try {
      await fsp.writeFile(probe, 'ok')
      await fsp.unlink(probe)
    } catch {
      return { ok: false, error: '所选目录不可写（请检查权限或换一个目录）' }
    }
    const serial = await getVolumeId(path)
    return { ok: true, volume_serial: serial }
  }

  /** 设置备份盘：校验通过后持久化设置并初始化冷藏区目录结构。 */
  async set(path: string, coldPeriodDays?: number): Promise<{ ok: boolean; error?: string; info?: BackupInfo }> {
    const v = await this.validate(path)
    if (!v.ok) return { ok: false, error: v.error }

    const coldRoot = coldStorageRoot(getActiveProfile().path, path)
    await this.fs.mkdirp(coldRoot)
    await this.fs.mkdirp(join(coldRoot, 'logs'))
    // 初始化 manifest（若不存在）
    const m = readManifest(coldRoot)
    writeManifest(coldRoot, m)

    this.db.setSetting('backup_drive_path', path)
    this.db.setSetting('cold_storage_root', coldRoot)
    this.db.setSetting('backup_volume_serial', v.volume_serial ?? null)
    if (coldPeriodDays !== undefined) this.db.setSetting('default_cold_period_days', coldPeriodDays)
    this.db.flush()

    return { ok: true, info: this.get()! }
  }

  /** 备份盘是否在线（外接盘可能被拔出，PRD §5.3）：路径存在且卷序列号匹配。 */
  async isOnline(): Promise<boolean> {
    const info = this.get()
    if (!info) return false
    if (!(await this.fs.exists(info.path))) return false
    if (!info.volume_serial) return true // 无记录则不强校验
    const cur = await getVolumeId(info.path)
    return cur === null || cur === info.volume_serial
  }
}
