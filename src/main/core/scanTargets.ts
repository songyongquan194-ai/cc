import type { ScanType } from '@shared/types'
import { expandEnv, normalizePath } from './pathUtils'

/** 快速扫描根目录（PRD §7.1）：低风险常见可清理项所在父目录。 */
const QUICK_ROOTS = [
  '%TEMP%',
  '%TMP%',
  'C:\\Windows\\Temp',
  '%LOCALAPPDATA%\\Microsoft\\Windows\\Explorer',
  '%LOCALAPPDATA%\\CrashDumps',
  'C:\\Windows\\Minidump',
  '%LOCALAPPDATA%\\Google\\Chrome\\User Data',
  '%LOCALAPPDATA%\\Microsoft\\Edge\\User Data'
]

/** 深度扫描根目录（PRD §7.2）：空间分析与不确定文件识别。 */
const DEEP_ROOTS = [
  '%USERPROFILE%\\Downloads',
  '%USERPROFILE%\\Desktop',
  '%LOCALAPPDATA%',
  '%APPDATA%',
  '%LOCALAPPDATA%\\npm-cache',
  '%APPDATA%\\npm-cache',
  '%LOCALAPPDATA%\\pip\\Cache',
  '%USERPROFILE%\\.gradle\\caches',
  '%USERPROFILE%\\.m2\\repository',
  '%USERPROFILE%\\.nuget\\packages',
  '%USERPROFILE%\\.cargo\\registry',
  '%APPDATA%\\Adobe\\Common'
]

/** 各类扫描的最大递归深度。快速扫描浅、深度扫描较深。 */
export const SCAN_DEPTH: Record<ScanType, number> = { quick: 4, deep: 8 }

/** 深度扫描中识别大文件的最小阈值（100MB）。 */
export const LARGE_FILE_MIN_BYTES = 100 * 1024 * 1024

/** 返回展开环境变量并去重后的扫描根列表（不校验是否存在，由调用方过滤）。 */
export function getScanRoots(type: ScanType, env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = type === 'quick' ? QUICK_ROOTS : DEEP_ROOTS
  const expanded = raw.map((r) => normalizePath(expandEnv(r, env)))
  return [...new Set(expanded)].filter((p) => !p.includes('%'))
}
