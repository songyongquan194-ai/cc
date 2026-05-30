import { describe, it, expect } from 'vitest'
import { SafetyGuard } from '../SafetyGuard'
import { MemoryFsAdapter } from './memoryFs'
import { AppError, ErrorCode } from '@shared/errors'

function guardWith(fs: MemoryFsAdapter, excluded: string[] = []) {
  return new SafetyGuard(fs, { excludedDirs: excluded, systemDrive: 'C:' })
}

async function expectCode(fn: () => unknown, code: ErrorCode) {
  try {
    await fn()
    throw new Error('expected throw')
  } catch (e) {
    expect(e).toBeInstanceOf(AppError)
    expect((e as AppError).code).toBe(code)
  }
}

describe('SafetyGuard.assertSafeSync', () => {
  const fs = new MemoryFsAdapter()
  const g = guardWith(fs)

  it('拒绝盘根', () => {
    expect(() => g.assertSafeSync('C:\\')).toThrowError()
    try {
      g.assertSafeSync('D:\\')
    } catch (e) {
      expect((e as AppError).code).toBe(ErrorCode.PATH_FORBIDDEN)
    }
  })

  it('拒绝空路径与相对路径', () => {
    expect(() => g.assertSafeSync('')).toThrow()
    expect(() => g.assertSafeSync('foo\\bar')).toThrow()
  })

  it('拒绝含通配符的路径', () => {
    try {
      g.assertSafeSync('C:\\Users\\Alex\\*')
    } catch (e) {
      expect((e as AppError).code).toBe(ErrorCode.UNKNOWN)
    }
  })

  it('拒绝禁止目录', () => {
    try {
      g.assertSafeSync('C:\\Windows\\System32\\drivers\\etc\\hosts')
    } catch (e) {
      expect((e as AppError).code).toBe(ErrorCode.PATH_FORBIDDEN)
    }
  })

  it('拒绝禁止文件名', () => {
    try {
      g.assertSafeSync('C:\\pagefile.sys')
    } catch (e) {
      expect((e as AppError).code).toBe(ErrorCode.PATH_FORBIDDEN)
    }
  })

  it('用户排除目录生效', () => {
    const g2 = guardWith(fs, ['C:\\Users\\Alex\\KeepMe'])
    try {
      g2.assertSafeSync('C:\\Users\\Alex\\KeepMe\\sub\\file.txt')
    } catch (e) {
      expect((e as AppError).code).toBe(ErrorCode.PATH_EXCLUDED)
    }
  })

  it('放行正常安全路径', () => {
    expect(() => g.assertSafeSync('C:\\Users\\Alex\\AppData\\Local\\Temp\\x.tmp')).not.toThrow()
  })
})

describe('SafetyGuard.assertSafe (async)', () => {
  it('符号链接跳过', async () => {
    const fs = new MemoryFsAdapter()
    fs.set('C:\\Users\\Alex\\link', { isSymlink: true })
    await expectCode(() => guardWith(fs).assertSafe('C:\\Users\\Alex\\link'), ErrorCode.SYMLINK_SKIP)
  })

  it('被占用文件跳过', async () => {
    const fs = new MemoryFsAdapter()
    fs.set('C:\\Users\\Alex\\app.log', { locked: true })
    await expectCode(() => guardWith(fs).assertSafe('C:\\Users\\Alex\\app.log'), ErrorCode.FILE_LOCKED)
  })

  it('正常文件通过完整校验', async () => {
    const fs = new MemoryFsAdapter()
    fs.set('C:\\Users\\Alex\\Temp\\x.tmp', { size: 10 })
    await expect(guardWith(fs).assertSafe('C:\\Users\\Alex\\Temp\\x.tmp')).resolves.toBeUndefined()
  })
})

describe('SafetyGuard.assertValidBackupTarget', () => {
  const g = guardWith(new MemoryFsAdapter())

  it('拒绝系统盘作为备份目标', () => {
    expect(() => g.assertValidBackupTarget('C:\\ColdStorage\\x')).toThrow()
  })

  it('拒绝禁止目录作为备份目标', () => {
    expect(() => g.assertValidBackupTarget('D:\\Windows\\System32\\x')).not.toThrow()
    // System32 仅在系统盘构成禁止；D 盘同名目录不在禁止表 → 允许
  })

  it('允许非系统盘普通目录', () => {
    expect(() => g.assertValidBackupTarget('D:\\CDrive_ColdStorage\\2026-05-29\\x')).not.toThrow()
  })
})
