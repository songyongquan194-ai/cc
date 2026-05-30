// 禁止目录列表（priority_class 0）。对应 TECH_DESIGN.md §4.3 / §7。
// 命中即拒绝任何清理/迁移操作，AI 与任何规则都不能覆盖。

import { normalizePath } from './pathUtils'

/** 系统盘符（运行时通常是 C:）。可由 settings 覆盖，默认 C。 */
const systemDrive = (process.env.SystemDrive || 'C:').toUpperCase()

/** 禁止目录前缀（已规范化、大写、无尾分隔符）。 */
export const FORBIDDEN_PREFIXES: string[] = [
  `${systemDrive}\\WINDOWS\\SYSTEM32`,
  `${systemDrive}\\WINDOWS\\SYSWOW64`,
  `${systemDrive}\\WINDOWS\\WINSXS`,
  `${systemDrive}\\WINDOWS\\BOOT`,
  `${systemDrive}\\WINDOWS\\FONTS`,
  `${systemDrive}\\PROGRAM FILES\\WINDOWSAPPS`,
  `${systemDrive}\\$WINDOWS.~BT`,
  `${systemDrive}\\RECOVERY`,
  `${systemDrive}\\PROGRAMDATA\\MICROSOFT\\WINDOWS DEFENDER`
]

/** 系统关键文件（页面/休眠/交换），按文件名兜底。 */
export const FORBIDDEN_FILENAMES = new Set([
  'PAGEFILE.SYS',
  'HIBERFIL.SYS',
  'SWAPFILE.SYS',
  'BOOTMGR',
  'NTLDR'
])

/** 判断路径是否落在禁止目录或为禁止文件。path 任意大小写均可。 */
export function isForbidden(path: string): boolean {
  const norm = normalizePath(path).toUpperCase()
  const base = norm.split('\\').pop() ?? ''
  if (FORBIDDEN_FILENAMES.has(base)) return true
  return FORBIDDEN_PREFIXES.some(
    (prefix) => norm === prefix || norm.startsWith(prefix + '\\')
  )
}
