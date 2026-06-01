import { describe, it, expect } from 'vitest'
import { macProfile } from '../mac'
import { SafetyGuard } from '../../SafetyGuard'
import { RestoreService } from '../../RestoreService'
import { MemoryFsAdapter } from '../../__tests__/memoryFs'
import type { ColdItem } from '@shared/types'
import { AppError, ErrorCode } from '@shared/errors'

const ENV = { HOME: '/Users/alex', TMPDIR: '/var/folders/zz/T' } as NodeJS.ProcessEnv

describe('macProfile path semantics', () => {
  it('normalizePath 折叠重复斜杠、去尾斜杠、保留根', () => {
    expect(macProfile.normalizePath('/Users//alex/')).toBe('/Users/alex')
    expect(macProfile.normalizePath('/')).toBe('/')
    // 不做反斜杠转换：反斜杠是普通字符
    expect(macProfile.normalizePath('/a/b')).toBe('/a/b')
  })

  it('isAbsolute / isVolumeRoot', () => {
    expect(macProfile.isAbsolute('/Users/alex')).toBe(true)
    expect(macProfile.isAbsolute('Users/alex')).toBe(false)
    expect(macProfile.isVolumeRoot('/')).toBe(true)
    expect(macProfile.isVolumeRoot('/Volumes/Backup')).toBe(true)
    expect(macProfile.isVolumeRoot('/Volumes/Backup/sub')).toBe(false)
  })

  it('volumeKeyOf / diskAnchor', () => {
    expect(macProfile.volumeKeyOf('/Users/alex/x')).toBe('/')
    expect(macProfile.volumeKeyOf('/Volumes/Backup/x')).toBe('/Volumes/Backup')
    expect(macProfile.volumeKeyOf('relative')).toBe(null)
    expect(macProfile.diskAnchor('/Volumes/Backup/x')).toBe('/Volumes/Backup')
    expect(macProfile.diskAnchor('/Users/alex')).toBe('/')
  })

  it('isUnder 大小写不敏感、按 / 分段', () => {
    expect(macProfile.isUnder('/Users/Alex', '/users/alex/downloads')).toBe(true)
    expect(macProfile.isUnder('/Users/Alex', '/Users/Alexandra')).toBe(false)
    expect(macProfile.isUnder('/', '/anything')).toBe(true)
  })

  it('isForbidden 命中 macOS 系统目录', () => {
    expect(macProfile.isForbidden('/System/Library/x')).toBe(true)
    expect(macProfile.isForbidden('/usr/bin/x')).toBe(true)
    expect(macProfile.isForbidden('/Library/Preferences/x')).toBe(true)
    expect(macProfile.isForbidden('/Volumes')).toBe(true)
    // 用户级 Library 不在系统禁止表内
    expect(macProfile.isForbidden('/Users/alex/Library/Caches/x')).toBe(false)
    expect(macProfile.isForbidden('/Volumes/Backup/x')).toBe(false)
  })

  it('expandEnv 展开 ~ 与 $VAR', () => {
    expect(macProfile.expandEnv('~/Library/Caches', ENV)).toBe('/Users/alex/Library/Caches')
    expect(macProfile.expandEnv('$TMPDIR/x', ENV)).toBe('/var/folders/zz/T/x')
    expect(macProfile.expandEnv('${HOME}/Downloads', ENV)).toBe('/Users/alex/Downloads')
    expect(macProfile.expandEnv('$MISSING/x', ENV)).toBe('$MISSING/x')
  })

  it('globToRegExp 单段通配，不跨 /', () => {
    const re = macProfile.globToRegExp('/Users/alex/*/Cache')
    expect(re.test('/Users/alex/Chrome/Cache')).toBe(true)
    expect(re.test('/Users/alex/a/b/Cache')).toBe(false)
    expect(re.test('/users/ALEX/chrome/cache')).toBe(true) // 大小写不敏感
  })

  it('getScanRoots 展开 ~ 并过滤未展开项', () => {
    const quick = macProfile.getScanRoots('quick', ENV)
    expect(quick).toContain('/Users/alex/Library/Caches')
    expect(quick).toContain('/var/folders/zz/T')
    expect(quick.every((p) => !p.includes('~') && !p.includes('$'))).toBe(true)
    const deep = macProfile.getScanRoots('deep', ENV)
    expect(deep).toContain('/Users/alex/Downloads')
    expect(deep).toContain('/Users/alex/Library/Developer/Xcode/DerivedData')
  })
})

describe('SafetyGuard with macProfile', () => {
  const fs = new MemoryFsAdapter()
  const guard = new SafetyGuard(fs, { excludedDirs: [], profile: macProfile })

  it('拒绝卷根与系统目录，放行用户缓存', () => {
    expect(() => guard.assertSafeSync('/')).toThrow()
    try {
      guard.assertSafeSync('/System/Library/x')
    } catch (e) {
      expect((e as AppError).code).toBe(ErrorCode.PATH_FORBIDDEN)
    }
    expect(() => guard.assertSafeSync('/Users/alex/Library/Caches/com.foo/x')).not.toThrow()
  })

  it('备份目标必须在非系统卷', () => {
    // 系统卷（/ 下）被拒
    expect(() => guard.assertValidBackupTarget('/Users/alex/Cold/x')).toThrow()
    // 外接卷允许
    expect(() => guard.assertValidBackupTarget('/Volumes/Backup/CDrive_ColdStorage/x')).not.toThrow()
  })
})

describe('RestoreService with macProfile', () => {
  function cold(over: Partial<ColdItem> = {}): ColdItem {
    return {
      id: 'id1',
      original_path: '/Users/alex/Downloads/setup.dmg',
      cold_path: '/Volumes/Backup/CDrive_ColdStorage/2026-06-01/pkg_installer/setup.dmg',
      size_bytes: 100,
      category: 'pkg_installer',
      risk_level: 'low',
      mtime: null,
      migrated_at: '2026-06-01T10:00:00.000Z',
      reason: null,
      explain: null,
      checksum: 'sha256:dmgbytes',
      cold_period_days: 90,
      expires_at: null,
      state: 'active',
      restorable: true,
      ...over
    }
  }

  it('恢复到 posix 原路径、重建父目录', async () => {
    const fs = new MemoryFsAdapter()
    const svc = new RestoreService(fs, macProfile)
    const c = cold()
    fs.set(c.cold_path, { size: 100, content: 'dmgbytes' })
    const r = await svc.restore(c, { createParent: true })
    expect(r.status).toBe('done')
    expect(r.restored_path).toBe('/Users/alex/Downloads/setup.dmg')
    expect(await fs.exists(c.original_path)).toBe(true)
  })

  it('恢复到系统目录被硬阻止', async () => {
    const fs = new MemoryFsAdapter()
    const svc = new RestoreService(fs, macProfile)
    const c = cold({ original_path: '/System/Library/evil.dylib' })
    fs.set(c.cold_path, { size: 100, content: 'dmgbytes' })
    const r = await svc.restore(c)
    expect(r.status).toBe('failed')
    expect(r.error_code).toBe(ErrorCode.PATH_FORBIDDEN)
  })
})
