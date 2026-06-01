import type { PlatformPath } from './platform'

/** 冷藏区根目录名（位于备份盘根，PRD §10.3）。 */
export const COLD_DIRNAME = 'CDrive_ColdStorage'

export function coldStorageRoot(path: PlatformPath, backupRoot: string): string {
  return path.join(backupRoot, COLD_DIRNAME)
}

/** YYYY-MM-DD（本地时区），用于按日期分目录。 */
export function dateDir(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 冷藏目标目录：<coldRoot>/<日期>/<分类>。 */
export function coldItemDir(
  path: PlatformPath,
  coldRoot: string,
  category: string,
  when: Date = new Date()
): string {
  return path.join(coldRoot, dateDir(when), category || 'uncategorized')
}

/**
 * 在目标目录下为 basename 生成不冲突的完整路径。
 * exists 回调判断候选是否已存在；冲突则追加 " (1)"、" (2)"…
 */
export async function resolveColdPath(
  path: PlatformPath,
  dir: string,
  basename: string,
  exists: (p: string) => Promise<boolean>
): Promise<string> {
  const ext = path.extname(basename)
  const stem = basename.slice(0, basename.length - ext.length)
  let candidate = path.join(dir, basename)
  let n = 1
  while (await exists(candidate)) {
    candidate = path.join(dir, `${stem} (${n})${ext}`)
    n++
  }
  return candidate
}

/** 计算冷藏到期时间；periodDays<=0 表示永久（返回 null）。 */
export function expiresAt(migratedAt: Date, periodDays: number): string | null {
  if (periodDays <= 0) return null
  const d = new Date(migratedAt.getTime() + periodDays * 24 * 60 * 60 * 1000)
  return d.toISOString()
}
