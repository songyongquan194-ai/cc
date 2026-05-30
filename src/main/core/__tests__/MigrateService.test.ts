import { describe, it, expect } from 'vitest'
import { MigrateService } from '../MigrateService'
import { SafetyGuard } from '../SafetyGuard'
import { MemoryFsAdapter } from './memoryFs'
import type { ScanItem } from '@shared/types'

function item(over: Partial<ScanItem> & { path: string }): ScanItem {
  return {
    size_bytes: 1000,
    mtime: '2025-01-01T00:00:00.000Z',
    atime: null,
    ext: '.iso',
    category: 'pkg_installer',
    risk_level: 'low',
    default_action: 'migrate',
    matched_rule: 'r',
    explain: '可重新下载',
    delete_policy: 'delete_self',
    ...over
  }
}

const COLD_ROOT = 'D:\\CDrive_ColdStorage'

function setup(excluded: string[] = []) {
  const fs = new MemoryFsAdapter()
  const guard = new SafetyGuard(fs, { excludedDirs: excluded, systemDrive: 'C:', backupDrive: 'D:' })
  return { fs, svc: new MigrateService(fs, guard), guard }
}

describe('MigrateService', () => {
  it('迁移：复制→校验→提交→删源，源消失、冷藏存在', async () => {
    const { fs, svc } = setup()
    fs.set('C:\\Users\\Alex\\Downloads\\setup.iso', { size: 1000, content: 'iso-bytes' })
    const report = await svc.migrate([item({ path: 'C:\\Users\\Alex\\Downloads\\setup.iso' })], {
      coldRoot: COLD_ROOT,
      periodDays: 90
    })
    expect(report.migrated).toBe(1)
    expect(report.freed_bytes).toBe(1000)
    expect(report.backup_used_bytes).toBe(1000)
    expect(await fs.exists('C:\\Users\\Alex\\Downloads\\setup.iso')).toBe(false)
    const cold = report.cold_items[0]
    expect(cold.state).toBe('active')
    expect(await fs.exists(cold.cold_path)).toBe(true)
    expect(cold.cold_path.startsWith(COLD_ROOT)).toBe(true)
    expect(cold.expires_at).not.toBeNull()
    // 不残留 .part
    expect(await fs.exists(cold.cold_path + '.part')).toBe(false)
  })

  it('源已不存在 → 跳过（E_SOURCE_GONE），不计失败', async () => {
    const { svc } = setup()
    // 不在 fs 中放置该源文件，模拟扫描后已被自动清理
    const report = await svc.migrate(
      [item({ path: 'C:\\Users\\Alex\\AppData\\Local\\Temp\\gone.tmp' })],
      { coldRoot: COLD_ROOT, periodDays: 90 }
    )
    expect(report.skipped).toBe(1)
    expect(report.failed).toBe(0)
    expect(report.migrated).toBe(0)
    expect(report.details[0].error_code).toBe('E_SOURCE_GONE')
  })

  it('校验不一致（正在使用）→ 跳过，源文件保留，不入冷藏', async () => {
    const { fs } = setup()
    // 定制 fs：目标 sha256 与源不同，模拟复制损坏
    class BadFs extends MemoryFsAdapter {
      async sha256(p: string): Promise<string> {
        return p.endsWith('.part') ? 'sha256:corrupt' : 'sha256:good'
      }
    }
    const badFs = new BadFs()
    const guard = new SafetyGuard(badFs, { excludedDirs: [], systemDrive: 'C:', backupDrive: 'D:' })
    const svc = new MigrateService(badFs, guard)
    badFs.set('C:\\Users\\Alex\\Downloads\\x.iso', { size: 500 })
    const report = await svc.migrate([item({ path: 'C:\\Users\\Alex\\Downloads\\x.iso', size_bytes: 500 })], {
      coldRoot: COLD_ROOT,
      periodDays: 90
    })
    expect(report.skipped).toBe(1)
    expect(report.failed).toBe(0)
    expect(report.details[0].error_code).toBe('E_CHECKSUM')
    expect(await badFs.exists('C:\\Users\\Alex\\Downloads\\x.iso')).toBe(true) // 源保留
    expect(report.cold_items.length).toBe(0)
    // void fs unused-var guard
    void fs
  })

  it('删源失败 → 已冷藏但记 source_kept，备份占用计入、释放不计', async () => {
    class KeepSrcFs extends MemoryFsAdapter {
      async unlink(p: string): Promise<void> {
        if (!p.endsWith('.part') && p.startsWith('C:')) {
          const err = Object.assign(new Error('locked'), { code: 'EBUSY' })
          throw err
        }
        return super.unlink(p)
      }
    }
    const fs = new KeepSrcFs()
    const guard = new SafetyGuard(fs, { excludedDirs: [], systemDrive: 'C:', backupDrive: 'D:' })
    const svc = new MigrateService(fs, guard)
    fs.set('C:\\Users\\Alex\\Downloads\\keep.iso', { size: 700 })
    const report = await svc.migrate([item({ path: 'C:\\Users\\Alex\\Downloads\\keep.iso', size_bytes: 700 })], {
      coldRoot: COLD_ROOT,
      periodDays: 90
    })
    expect(report.source_kept).toBe(1)
    expect(report.freed_bytes).toBe(0)
    expect(report.backup_used_bytes).toBe(700)
    expect(await fs.exists('C:\\Users\\Alex\\Downloads\\keep.iso')).toBe(true)
  })

  it('排除目录内的项被跳过', async () => {
    const { fs, svc } = setup(['C:\\Users\\Alex\\Keep'])
    fs.set('C:\\Users\\Alex\\Keep\\big.iso', { size: 1000 })
    const report = await svc.migrate([item({ path: 'C:\\Users\\Alex\\Keep\\big.iso' })], {
      coldRoot: COLD_ROOT,
      periodDays: 90
    })
    expect(report.skipped).toBe(1)
    expect(report.details[0].error_code).toBe('E_PATH_EXCLUDED')
    expect(await fs.exists('C:\\Users\\Alex\\Keep\\big.iso')).toBe(true)
  })

  it('高风险项不迁移', async () => {
    const { fs, svc } = setup()
    fs.set('C:\\Users\\Alex\\chat\\Msg.db', { size: 1000 })
    const report = await svc.migrate(
      [item({ path: 'C:\\Users\\Alex\\chat\\Msg.db', risk_level: 'high' })],
      { coldRoot: COLD_ROOT, periodDays: 90 }
    )
    expect(report.skipped).toBe(1)
    expect(report.migrated).toBe(0)
  })

  it('永久冷藏 periodDays<=0 → expires_at 为 null', async () => {
    const { fs, svc } = setup()
    fs.set('C:\\Users\\Alex\\Downloads\\perm.iso', { size: 100 })
    const report = await svc.migrate([item({ path: 'C:\\Users\\Alex\\Downloads\\perm.iso', size_bytes: 100 })], {
      coldRoot: COLD_ROOT,
      periodDays: -1
    })
    expect(report.cold_items[0].expires_at).toBeNull()
  })
})
