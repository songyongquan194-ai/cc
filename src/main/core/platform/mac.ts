// macOS 平台档：posix 路径语义 + macOS 系统禁止目录 + 用户级缓存/开发缓存扫描根。
import { posix } from 'path'
import { homedir } from 'os'
import type { PlatformProfile } from './Profile'
import type { ScanType } from '@shared/types'

/** 规范化 posix 路径：折叠重复 /，去尾 /（根 / 保留）。不做反斜杠转换。 */
export function normalizePath(p: string): string {
  let s = p.trim().replace(/\/+/g, '/')
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1)
  return s
}

export function isAbsolute(p: string): boolean {
  return normalizePath(p).startsWith('/')
}

/** 卷根：/ 或 /Volumes/<name>。 */
export function isVolumeRoot(p: string): boolean {
  const s = normalizePath(p)
  return s === '/' || /^\/Volumes\/[^/]+$/.test(s)
}

/** 取所在卷标识：/Volumes/X 下 → /Volumes/X；其余绝对路径 → /；非绝对 → null。 */
export function volumeKeyOf(p: string): string | null {
  const s = normalizePath(p)
  if (!s.startsWith('/')) return null
  const m = s.match(/^\/Volumes\/([^/]+)/)
  return m ? `/Volumes/${m[1]}` : '/'
}

export function diskAnchor(p: string): string {
  return volumeKeyOf(p) ?? '/'
}

/** 大小写不敏感（APFS 默认大小写不敏感），段边界用 /。 */
export function isUnder(parent: string, child: string): boolean {
  const a = normalizePath(parent).toLowerCase()
  const b = normalizePath(child).toLowerCase()
  if (a === '/') return b.startsWith('/')
  return b === a || b.startsWith(a + '/')
}

export function hasWildcard(p: string): boolean {
  return /[*?]/.test(p)
}

/** 展开 $VAR / ${VAR} / 前导 ~（→ $HOME）。缺失变量保持原样。 */
export function expandEnv(p: string, env: NodeJS.ProcessEnv = process.env): string {
  let s = p
  if (s === '~' || s.startsWith('~/')) {
    s = (env.HOME || homedir()) + s.slice(1)
  }
  s = s.replace(/\$\{([^}]+)\}/g, (whole, name: string) => env[name] ?? whole)
  s = s.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (whole, name: string) => env[name] ?? whole)
  return s
}

/** 单段 glob → RegExp（* → [^/]*，? → [^/]），大小写不敏感。 */
export function globToRegExp(glob: string): RegExp {
  const norm = normalizePath(glob)
  let re = ''
  for (const ch of norm) {
    if (ch === '*') re += '[^/]*'
    else if (ch === '?') re += '[^/]'
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'i')
}

/** macOS 系统关键目录前缀（大小写不敏感、规范化后）。命中即禁止任何清理/迁移/恢复。 */
export const FORBIDDEN_PREFIXES: string[] = [
  '/System',
  '/usr',
  '/bin',
  '/sbin',
  '/Library',
  '/private/etc',
  '/private/var/db',
  '/Applications',
  '/opt',
  '/dev',
  '/cores'
]

export function isForbidden(p: string): boolean {
  const lower = normalizePath(p).toLowerCase()
  // /Volumes 根本身禁止（不操作挂载点）；/Volumes/X/... 允许。
  if (lower === '/volumes') return true
  return FORBIDDEN_PREFIXES.some((pre) => {
    const pl = pre.toLowerCase()
    return lower === pl || lower.startsWith(pl + '/')
  })
}

/** 快速扫描根：用户级缓存/日志/浏览器缓存与系统临时目录。 */
const QUICK_ROOTS = [
  '$TMPDIR',
  '~/Library/Caches',
  '~/Library/Logs',
  '~/Library/Caches/Google/Chrome',
  '~/Library/Caches/com.apple.Safari'
]

/** 深度扫描根：下载/桌面、应用支持、各类开发缓存。 */
const DEEP_ROOTS = [
  '~/Downloads',
  '~/Desktop',
  '~/Library/Caches',
  '~/Library/Application Support',
  '~/.npm',
  '~/.gradle/caches',
  '~/.m2/repository',
  '~/.cargo/registry',
  '~/Library/Caches/pip',
  '~/.nuget/packages',
  '~/Library/Developer/Xcode/DerivedData',
  '~/Library/Developer/CoreSimulator/Caches'
]

export function getScanRoots(type: ScanType, env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = type === 'quick' ? QUICK_ROOTS : DEEP_ROOTS
  const expanded = raw.map((r) => normalizePath(expandEnv(r, env)))
  return [...new Set(expanded)].filter((p) => !p.includes('$') && !p.includes('~'))
}

export const macProfile: PlatformProfile = {
  id: 'darwin',
  path: posix,
  systemAnchor: '/',
  systemVolumeKey: '/',
  normalizePath,
  isAbsolute,
  isVolumeRoot,
  volumeKeyOf,
  diskAnchor,
  isUnder,
  hasWildcard,
  expandEnv,
  globToRegExp,
  isForbidden,
  getScanRoots
}
