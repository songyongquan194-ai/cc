// 平台档抽象：把"路径语义 + 禁止目录 + 扫描根 + 系统盘锚点"封装成可切换的 Profile。
// Windows 与 macOS 各提供一份实现；核心类默认取 getActiveProfile()，测试可注入。
import type { ScanType } from '@shared/types'
import type { win32, posix } from 'path'

/** node 的 path 子模块（win32 用 \，posix 用 /）。 */
export type PlatformPath = typeof win32 | typeof posix

export interface PlatformProfile {
  /** 平台标识。 */
  id: 'win32' | 'darwin'
  /** path 模块：供 join/basename/dirname/extname 使用。 */
  path: PlatformPath
  /** 概览取系统盘空间用的锚点（win: 'C:\\'，mac: '/'）。 */
  systemAnchor: string
  /** 系统卷标识（win: 'C:'，mac: '/'）。用于"备份目标不能在系统卷"判断。 */
  systemVolumeKey: string

  /** 规范化路径（统一分隔符、折叠重复分隔、去尾分隔；卷根保留）。 */
  normalizePath(p: string): string
  /** 是否绝对路径。 */
  isAbsolute(p: string): boolean
  /** 是否卷根（win: C:\；mac: / 或 /Volumes/<name>）。 */
  isVolumeRoot(p: string): boolean
  /** 取所在卷的标识（win: 'C:'；mac: '/Volumes/X' 或 '/'）。无法解析返回 null。 */
  volumeKeyOf(p: string): string | null
  /** 传给 fs.diskSpace 的卷内锚点（卷根）。 */
  diskAnchor(p: string): string
  /** child 是否在 parent 之内（含相等），大小写不敏感。 */
  isUnder(parent: string, child: string): boolean
  /** 是否含未展开通配符。 */
  hasWildcard(p: string): boolean
  /** 展开环境变量占位符（win: %VAR%；mac: $VAR/${VAR}/~）。 */
  expandEnv(p: string, env?: NodeJS.ProcessEnv): string
  /** 单段 glob → RegExp（不跨分隔符），大小写不敏感。 */
  globToRegExp(glob: string): RegExp
  /** 是否落在系统禁止目录/文件（硬规则，任何规则都不能覆盖）。 */
  isForbidden(path: string): boolean
  /** 返回展开并去重后的扫描根（不校验存在性，由调用方过滤）。 */
  getScanRoots(type: ScanType, env?: NodeJS.ProcessEnv): string[]
}
