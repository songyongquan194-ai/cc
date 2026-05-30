import type { Db } from '../infra/Db'
import { findDuplicates, reclaimableBytes, type DupFile, type DupGroup } from '@core/DuplicateFinder'

export interface DuplicateResult {
  groups: DupGroup[]
  group_count: number
  total_reclaimable: number
}

/**
 * 重复文件候选（PRD §9）：基于某次扫描的 scan_items 做「同名同大小」分组。
 * 只读、只展示——不删除、不默认全盘哈希。默认仅分析 ≥1MB 的文件以减少噪声。
 */
export class DuplicateService {
  constructor(private db: Db) {}

  groups(scanId: number, minSize = 1024 * 1024): DuplicateResult {
    const rows = this.db.query<DupFile>(
      `SELECT path, size_bytes, mtime, atime, category FROM scan_items WHERE scan_id = ?`,
      [scanId]
    )
    const groups = findDuplicates(rows, { minSize })
    const total = groups.reduce((s, g) => s + reclaimableBytes(g), 0)
    return { groups, group_count: groups.length, total_reclaimable: total }
  }
}
