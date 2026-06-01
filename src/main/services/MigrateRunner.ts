import type { WebContents } from 'electron'
import type { Db } from '../infra/Db'
import type { ScanItem, ColdItem } from '@shared/types'
import { NodeFsAdapter } from '@core/NodeFsAdapter'
import { SafetyGuard } from '@core/SafetyGuard'
import { getActiveProfile } from '@core/platform'
import { MigrateService, type MigrateReport, type MigrateLogEntry } from '@core/MigrateService'
import { evaluateMigration, type MigrationPlan } from '@core/spacePolicy'
import { AppError, ErrorCode } from '@shared/errors'
import { BackupService } from './BackupService'
import { appendManifestItems } from '../infra/manifest'

export interface MigratePlanResult extends MigrationPlan {
  backup_set: boolean
  item_count: number
}

/**
 * 迁移服务编排：选项 → 空间计划核算 → MigrateService 执行 → cold_items + manifest.json 双写 + operations 日志。
 * 未设备份盘或空间计划不通过则不执行（PRD §5.4 / §20 验收）。
 */
export class MigrateRunner {
  private fs = new NodeFsAdapter()
  private signal: { cancelled: boolean } | null = null

  constructor(
    private db: Db,
    private backup: BackupService
  ) {}

  cancel(): void {
    if (this.signal) this.signal.cancelled = true
  }

  /** 该扫描中建议迁移的项（safe/low/medium + action=migrate）。 */
  preview(scanId: number): ScanItem[] {
    return this.db.query<ScanItem>(
      `SELECT path, size_bytes, category, risk_level, default_action,
              matched_rule, mtime, atime, ext, explain_tmpl AS explain
       FROM scan_items
       WHERE scan_id = ? AND default_action = 'migrate' AND risk_level IN ('safe','low','medium')
       ORDER BY size_bytes DESC`,
      [scanId]
    )
  }

  private select(scanId: number, paths?: string[]): ScanItem[] {
    const all = this.preview(scanId)
    return paths && paths.length ? all.filter((i) => paths.includes(i.path)) : all
  }

  /** 迁移计划：返回释放C盘/占用备份盘/迁后剩余三数字（PRD §5.4 硬要求），不执行任何写操作。 */
  async plan(scanId: number, paths?: string[]): Promise<MigratePlanResult> {
    const items = this.select(scanId, paths)
    const batchBytes = items.reduce((s, i) => s + i.size_bytes, 0)
    const info = this.backup.get()

    if (!info) {
      return {
        allowed: false,
        error_code: ErrorCode.NO_BACKUP_DRIVE,
        c_freed_bytes: batchBytes,
        backup_used_bytes: 0,
        backup_free_after: 0,
        system_free_after: 0,
        backup_threshold: 0,
        warnings: [],
        backup_set: false,
        item_count: items.length
      }
    }

    const backup = await this.fs.diskSpace(info.path)
    const system = await this.fs.diskSpace(getActiveProfile().systemAnchor)
    const plan = evaluateMigration({ backup, system, batchBytes })
    return { ...plan, backup_set: true, item_count: items.length }
  }

  async run(scanId: number, paths?: string[], sender?: WebContents): Promise<MigrateReport> {
    const info = this.backup.get()
    if (!info) throw new AppError(ErrorCode.NO_BACKUP_DRIVE)

    const planResult = await this.plan(scanId, paths)
    if (!planResult.allowed) {
      throw new AppError((planResult.error_code as ErrorCode) ?? ErrorCode.UNKNOWN)
    }

    const items = this.select(scanId, paths)
    const excludedDirs = this.db.getSetting<string[]>('excluded_dirs', [])
    const profile = getActiveProfile()
    const guard = new SafetyGuard(this.fs, {
      excludedDirs,
      systemDrive: 'C:',
      backupDrive: profile.volumeKeyOf(info.path)
    })
    const svc = new MigrateService(this.fs, guard, profile)

    this.signal = { cancelled: false }
    const batchId = `migrate-${Date.now()}`
    const colds: ColdItem[] = []

    const report = await svc.migrate(items, {
      coldRoot: info.cold_root,
      periodDays: info.cold_period_days,
      signal: this.signal,
      onItem: (c) => {
        colds.push(c)
        this.insertCold(c)
      },
      onLog: (e) => {
        this.logMigrate(e, batchId)
        if (sender && !sender.isDestroyed()) sender.send('migrate:progress', e)
      }
    })

    if (colds.length) appendManifestItems(info.cold_root, colds)
    this.db.flush()
    this.signal = null
    return report
  }

  private insertCold(c: ColdItem): void {
    this.db.run(
      `INSERT INTO cold_items(id, original_path, cold_path, size_bytes, category, risk_level,
         mtime, migrated_at, reason, explain, checksum, cold_period_days, expires_at, state, restorable)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        c.id, c.original_path, c.cold_path, c.size_bytes, c.category, c.risk_level,
        c.mtime, c.migrated_at, c.reason, c.explain, c.checksum, c.cold_period_days,
        c.expires_at, c.state, c.restorable ? 1 : 0
      ]
    )
  }

  private logMigrate(e: MigrateLogEntry, batchId: string): void {
    this.db.logOperation({
      ts: new Date().toISOString(),
      op_type: 'migrate',
      path: e.path,
      dest_path: e.dest_path,
      size_bytes: e.size_bytes,
      category: e.category,
      risk_level: e.risk_level,
      action: 'migrate',
      status: e.status === 'success' || e.status === 'source_kept' ? 'success' : e.status,
      error_code: e.error_code,
      error_detail: e.error_detail,
      user_confirm: 'normal',
      batch_id: batchId
    })
  }
}
