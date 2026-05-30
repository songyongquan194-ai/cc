import { describe, it, expect } from 'vitest'
import {
  normalizePath,
  isDriveRoot,
  driveLetter,
  hasWildcard,
  isAbsoluteWin,
  isUnder,
  expandEnv,
  globToRegExp
} from '../pathUtils'

describe('pathUtils', () => {
  it('normalizePath 统一分隔符并去尾斜杠', () => {
    expect(normalizePath('C:/Users//Alex/')).toBe('C:\\Users\\Alex')
    expect(normalizePath('C:\\')).toBe('C:\\')
  })

  it('isDriveRoot', () => {
    expect(isDriveRoot('C:\\')).toBe(true)
    expect(isDriveRoot('C:')).toBe(true)
    expect(isDriveRoot('C:\\Users')).toBe(false)
  })

  it('driveLetter', () => {
    expect(driveLetter('d:\\x')).toBe('D:')
    expect(driveLetter('\\\\server\\share')).toBe(null)
  })

  it('hasWildcard', () => {
    expect(hasWildcard('C:\\a\\*')).toBe(true)
    expect(hasWildcard('C:\\a\\b')).toBe(false)
  })

  it('isAbsoluteWin', () => {
    expect(isAbsoluteWin('C:\\a')).toBe(true)
    expect(isAbsoluteWin('\\\\srv\\s')).toBe(true)
    expect(isAbsoluteWin('a\\b')).toBe(false)
  })

  it('isUnder 大小写不敏感且需路径段边界', () => {
    expect(isUnder('C:\\Users', 'c:\\users\\alex')).toBe(true)
    expect(isUnder('C:\\Users', 'C:\\Users')).toBe(true)
    expect(isUnder('C:\\User', 'C:\\Users\\alex')).toBe(false)
  })

  it('expandEnv 展开占位符', () => {
    const env = { LOCALAPPDATA: 'C:\\Users\\Alex\\AppData\\Local' } as NodeJS.ProcessEnv
    expect(expandEnv('%LOCALAPPDATA%\\Cache', env)).toBe('C:\\Users\\Alex\\AppData\\Local\\Cache')
    expect(expandEnv('%MISSING%\\x', env)).toBe('%MISSING%\\x')
  })

  it('globToRegExp 单段通配，不跨分隔符', () => {
    const re = globToRegExp('C:\\a\\*\\Cache')
    expect(re.test('C:\\a\\b\\Cache')).toBe(true)
    expect(re.test('C:\\a\\b\\c\\Cache')).toBe(false)
    expect(re.test('c:\\A\\B\\cache')).toBe(true) // 大小写不敏感
  })
})
