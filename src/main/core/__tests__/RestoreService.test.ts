import { describe, it, expect } from 'vitest'
import { RestoreService } from '../RestoreService'
import { MemoryFsAdapter } from './memoryFs'
import type { ColdItem } from '@shared/types'

function cold(over: Partial<ColdItem> = {}): ColdItem {
  return {
    id: 'id1',
    original_path: 'C:\\Users\\Alex\\Downloads\\setup.iso',
    cold_path: 'D:\\CDrive_ColdStorage\\2026-05-29\\pkg_installer\\setup.iso',
    size_bytes: 100,
    category: 'pkg_installer',
    risk_level: 'low',
    mtime: null,
    migrated_at: '2026-05-29T10:00:00.000Z',
    reason: null,
    explain: null,
    checksum: 'sha256:isobytes',
    cold_period_days: 90,
    expires_at: null,
    state: 'active',
    restorable: true,
    ...over
  }
}

function setup() {
  const fs = new MemoryFsAdapter()
  return { fs, svc: new RestoreService(fs) }
}

describe('RestoreService', () => {
  it('正常恢复：复制回原路径、校验通过、默认保留冷藏副本', async () => {
    const { fs, svc } = setup()
    const c = cold()
    fs.set(c.cold_path, { size: 100, content: 'isobytes' })
    fs.set('C:\\Users\\Alex\\Downloads', { isDir: true }) // 父目录存在
    const r = await svc.restore(c)
    expect(r.status).toBe('done')
    expect(r.restored_path).toBe(c.original_path)
    expect(await fs.exists(c.original_path)).toBe(true)
    expect(await fs.exists(c.cold_path)).toBe(true) // 冷藏保留
    expect(r.cold_kept).toBe(true)
    expect(await fs.exists(c.original_path + '.part')).toBe(false)
  })

  it('removeCold=true 时恢复后删除冷藏副本', async () => {
    const { fs, svc } = setup()
    const c = cold()
    fs.set(c.cold_path, { size: 100, content: 'isobytes' })
    fs.set('C:\\Users\\Alex\\Downloads', { isDir: true })
    const r = await svc.restore(c, { removeCold: true })
    expect(r.status).toBe('done')
    expect(await fs.exists(c.cold_path)).toBe(false)
    expect(r.cold_kept).toBe(false)
  })

  it('冷藏文件丢失 → E_COLD_MISSING', async () => {
    const { svc } = setup()
    const r = await svc.restore(cold())
    expect(r.status).toBe('failed')
    expect(r.error_code).toBe('E_COLD_MISSING')
  })

  it('恢复到系统关键目录被硬阻止', async () => {
    const { fs, svc } = setup()
    const c = cold({ original_path: 'C:\\Windows\\System32\\evil.dll' })
    fs.set(c.cold_path, { size: 100, content: 'isobytes' })
    const r = await svc.restore(c)
    expect(r.status).toBe('failed')
    expect(r.error_code).toBe('E_PATH_FORBIDDEN')
    expect(await fs.exists(c.original_path)).toBe(false)
  })

  it('父目录缺失：默认失败，createParent 时重建并恢复', async () => {
    const { fs, svc } = setup()
    const c = cold()
    fs.set(c.cold_path, { size: 100, content: 'isobytes' })

    const fail = await svc.restore(c)
    expect(fail.status).toBe('failed')
    expect(fail.error_code).toBe('E_PARENT_MISSING')
    expect(fail.cold_kept).toBe(true)

    const ok = await svc.restore(c, { createParent: true })
    expect(ok.status).toBe('done')
    expect(await fs.exists(c.original_path)).toBe(true)
  })

  it('目标已存在：cancel/keep_both/overwrite 三分支', async () => {
    const c = cold()

    // cancel
    {
      const { fs, svc } = setup()
      fs.set(c.cold_path, { size: 100, content: 'isobytes' })
      fs.set('C:\\Users\\Alex\\Downloads', { isDir: true })
      fs.set(c.original_path, { size: 50, content: 'existing' })
      const r = await svc.restore(c, { onConflict: 'cancel' })
      expect(r.status).toBe('cancelled')
      expect(r.error_code).toBe('E_DEST_EXISTS')
    }
    // keep_both
    {
      const { fs, svc } = setup()
      fs.set(c.cold_path, { size: 100, content: 'isobytes' })
      fs.set('C:\\Users\\Alex\\Downloads', { isDir: true })
      fs.set(c.original_path, { size: 50, content: 'existing' })
      const r = await svc.restore(c, { onConflict: 'keep_both' })
      expect(r.status).toBe('done')
      expect(r.restored_path).not.toBe(c.original_path)
      expect(await fs.exists(c.original_path)).toBe(true) // 原文件未被动
    }
    // overwrite
    {
      const { fs, svc } = setup()
      fs.set(c.cold_path, { size: 100, content: 'isobytes' })
      fs.set('C:\\Users\\Alex\\Downloads', { isDir: true })
      fs.set(c.original_path, { size: 50, content: 'existing' })
      const r = await svc.restore(c, { onConflict: 'overwrite' })
      expect(r.status).toBe('done')
      expect(r.restored_path).toBe(c.original_path)
    }
  })

  it('校验不一致 → 回滚，目标不生成，冷藏保留', async () => {
    const { fs, svc } = setup()
    const c = cold({ checksum: 'sha256:expected' })
    fs.set(c.cold_path, { size: 100, content: 'corrupted' }) // sha256 = sha256:corrupted ≠ expected
    fs.set('C:\\Users\\Alex\\Downloads', { isDir: true })
    const r = await svc.restore(c)
    expect(r.status).toBe('failed')
    expect(r.error_code).toBe('E_CHECKSUM')
    expect(await fs.exists(c.original_path)).toBe(false)
    expect(await fs.exists(c.cold_path)).toBe(true)
    expect(r.cold_kept).toBe(true)
  })

  it('precheck 汇总阻塞项', async () => {
    const { fs, svc } = setup()
    const c = cold()
    fs.set(c.cold_path, { size: 100, content: 'isobytes' })
    fs.set(c.original_path, { size: 50 }) // 目标已存在；父目录缺失
    const pc = await svc.precheck(c)
    expect(pc.ok).toBe(false)
    expect(pc.issues).toContain('parent_missing')
    expect(pc.issues).toContain('target_exists')
  })
})
