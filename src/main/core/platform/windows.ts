// Windows 平台档：直接复用现有纯函数，行为与改造前完全一致（零回归）。
import { win32 } from 'path'
import type { PlatformProfile } from './Profile'
import type { ScanType } from '@shared/types'
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
import { isForbidden } from '../forbidden'
import { getScanRoots } from '../scanTargets'

export const windowsProfile: PlatformProfile = {
  id: 'win32',
  path: win32,
  systemAnchor: 'C:\\',
  systemVolumeKey: 'C:',

  normalizePath,
  isAbsolute: isAbsoluteWin,
  isVolumeRoot: isDriveRoot,
  volumeKeyOf: driveLetter,
  diskAnchor(p: string): string {
    const d = driveLetter(p)
    return d ? d + '\\' : 'C:\\'
  },
  isUnder,
  hasWildcard,
  expandEnv,
  globToRegExp,
  isForbidden,
  getScanRoots(type: ScanType, env: NodeJS.ProcessEnv = process.env): string[] {
    return getScanRoots(type, env)
  }
}
