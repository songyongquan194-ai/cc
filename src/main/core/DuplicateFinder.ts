import { win32 as path } from 'path'

/** 参与去重分析的文件（来自 scan_items，绝不含内容）。 */
export interface DupFile {
  path: string
  size_bytes: number
  mtime: string | null
  atime: string | null
  category: string | null
}

export interface DupGroup {
  /** 分组键：归一化文件名 + 大小 */
  key: string
  size_bytes: number
  count: number
  files: DupFile[]
  /** 启发式建议保留的文件路径（仅建议，不自动删除，PRD §9.3） */
  suggested_keep: string
  /** 建议依据（展示给用户，含不确定性说明） */
  reason: string
}

/** 命名中暗示「副本/临时」的标记（用于归一化与降权）。 */
const COPY_MARKERS = [
  /\s*-\s*副本/gi,
  /\s*-\s*copy/gi,
  /\s*\(\d+\)/g,
  /\s*-\s*\d+$/g,
  /\s*副本/g,
  /\bcopy\b/gi,
  /\bbak\b/gi,
  /\bbackup\b/gi
]

/** 路径优先级：越「正式」分越高。 */
const KEEP_BONUS: { re: RegExp; score: number }[] = [
  { re: /[\\/]documents[\\/]/i, score: 30 },
  { re: /[\\/]文档[\\/]/i, score: 30 },
  { re: /[\\/]onedrive[\\/]/i, score: 20 },
  { re: /[\\/]pictures[\\/]/i, score: 10 },
  { re: /[\\/]desktop[\\/]/i, score: 5 }
]
const KEEP_PENALTY: { re: RegExp; score: number }[] = [
  { re: /[\\/]downloads?[\\/]/i, score: 25 },
  { re: /[\\/]下载[\\/]/i, score: 25 },
  { re: /[\\/]temp[\\/]/i, score: 40 },
  { re: /[\\/]tmp[\\/]/i, score: 40 },
  { re: /[\\/]cache[\\/]/i, score: 30 },
  { re: /[\\/]\$recycle\.bin[\\/]/i, score: 100 },
  { re: /(副本|\bcopy\b|\bbak\b|\bbackup\b|\(\d+\))/i, score: 35 } // 文件名含副本标记
]

/** 归一化文件名：小写、去扩展名外的副本标记，用于把「合同.pdf」与「合同 - 副本.pdf」归到一组。 */
function normalizeName(p: string): string {
  const base = path.basename(p)
  const ext = path.extname(base).toLowerCase()
  let stem = base.slice(0, base.length - ext.length).toLowerCase().trim()
  for (const re of COPY_MARKERS) stem = stem.replace(re, '')
  stem = stem.replace(/\s+/g, ' ').trim()
  return `${stem}${ext}`
}

/** 给单个文件打「应保留」分（越高越像正式留存位置）。 */
function keepScore(f: DupFile): number {
  let s = 0
  for (const { re, score } of KEEP_BONUS) if (re.test(f.path)) s += score
  for (const { re, score } of KEEP_PENALTY) if (re.test(f.path)) s -= score
  // 较新的修改时间略微加分（同分时打破平局）
  if (f.mtime) {
    const t = Date.parse(f.mtime)
    if (!Number.isNaN(t)) s += t / 1e13 // 量级 ~0..0.17，仅作平局微调
  }
  return s
}

function buildReason(keep: DupFile, group: DupFile[]): string {
  const others = group.filter((f) => f.path !== keep.path)
  const keepDir = path.dirname(keep.path)
  const hint =
    /documents|文档|onedrive/i.test(keep.path)
      ? `「${keepDir}」更像正式保存位置`
      : `「${keepDir}」相对其他副本更像主文件`
  const otherHint = others.some((f) => /downloads?|下载|temp|tmp|cache|副本|copy/i.test(f.path))
    ? '其余候选位于下载/临时/副本目录，更像可清理副本。'
    : '其余为同名同大小副本。'
  return `${hint}；${otherHint}大小相同，但未做内容哈希确认（默认不全盘哈希）。`
}

/**
 * 在已扫描文件中查找重复候选（PRD §9：MVP 只做「同名同大小」候选，不做全盘哈希、不自动删除）。
 * 分组键 = 归一化文件名 + 大小；仅返回 count>1 的组。
 */
export function findDuplicates(files: DupFile[], opts?: { minSize?: number }): DupGroup[] {
  const minSize = opts?.minSize ?? 1
  const map = new Map<string, DupFile[]>()
  for (const f of files) {
    if (f.size_bytes < minSize) continue
    const key = `${normalizeName(f.path)}::${f.size_bytes}`
    const arr = map.get(key)
    if (arr) arr.push(f)
    else map.set(key, [f])
  }

  const groups: DupGroup[] = []
  for (const [key, arr] of map) {
    if (arr.length < 2) continue
    // 去掉同一路径的重复条目
    const uniq = Array.from(new Map(arr.map((f) => [f.path, f])).values())
    if (uniq.length < 2) continue
    const keep = uniq.reduce((best, f) => (keepScore(f) > keepScore(best) ? f : best), uniq[0])
    groups.push({
      key,
      size_bytes: uniq[0].size_bytes,
      count: uniq.length,
      files: uniq,
      suggested_keep: keep.path,
      reason: buildReason(keep, uniq)
    })
  }
  // 按「可回收空间」降序：组大小 ×（份数-1）
  groups.sort((a, b) => b.size_bytes * (b.count - 1) - a.size_bytes * (a.count - 1))
  return groups
}

/** 一组重复文件可回收的空间（保留 1 份，其余视为冗余）。 */
export function reclaimableBytes(group: DupGroup): number {
  return group.size_bytes * (group.count - 1)
}
