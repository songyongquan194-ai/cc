import type { WebContents } from 'electron'
import type { Db } from '../infra/Db'
import type { ScanItem, ScanProgress, ScanType } from '@shared/types'
import { NodeFsAdapter } from '@core/NodeFsAdapter'
import { ScanEngine } from '@core/ScanEngine'
import { buildRuleEngine } from '@core/Classifier'
import { SCAN_DEPTH, LARGE_FILE_MIN_BYTES } from '@core/scanTargets'
import { getActiveProfile } from '@core/platform'
import { loadBuiltinRules } from '../infra/rulesLoader'

export interface ScanStartResult {
  scanId: number
  total_files: number
  safe_bytes: number
  migratable_bytes: number
  highrisk_bytes: number
  elapsed_ms: number
  cancelled: boolean
  dir_error_count: number
}

/** 扫描服务：连接 NodeFsAdapter + RuleEngine + Db + 进度推送。 */
export class ScanService {
  private fs = new NodeFsAdapter()
  private engine: ScanEngine
  private signal: { cancelled: boolean } | null = null

  constructor(
    private db: Db,
    private resourcesPath?: string
  ) {
    this.engine = this.buildEngine()
  }

  private buildEngine(): ScanEngine {
    const builtin = loadBuiltinRules(this.resourcesPath, getActiveProfile().id)
    const userRules = this.loadUserRules()
    return new ScanEngine(this.fs, buildRuleEngine(builtin, userRules))
  }

  /** 用户确认新增/删除 NL 规则后重建引擎，使其当次扫描即生效。 */
  reloadRules(): void {
    this.engine = this.buildEngine()
  }

  private loadUserRules() {
    const rows = this.db.query<{ json: string }>(
      "SELECT json FROM user_rules WHERE enabled = 1 AND source = 'nl_generated'"
    )
    return rows.flatMap((r) => {
      try {
        return [JSON.parse(r.json)]
      } catch {
        return []
      }
    })
  }

  cancel(): void {
    if (this.signal) this.signal.cancelled = true
  }

  async run(type: ScanType, sender: WebContents): Promise<ScanStartResult> {
    const excludedDirs = this.db.getSetting<string[]>('excluded_dirs', [])
    const roots = getActiveProfile().getScanRoots(type)

    // 过滤实际存在的根目录
    const existingRoots: string[] = []
    for (const r of roots) {
      if (await this.fs.exists(r)) existingRoots.push(r)
    }

    const startedAt = new Date().toISOString()
    this.db.run('INSERT INTO scans(type, started_at, status) VALUES(?, ?, ?)', [
      type,
      startedAt,
      'running'
    ])
    const scanId = this.db.query<{ id: number }>('SELECT last_insert_rowid() AS id')[0].id

    this.signal = { cancelled: false }

    const insertItem = (item: ScanItem): void => {
      this.db.run(
        `INSERT INTO scan_items(scan_id, path, size_bytes, category, risk_level, default_action,
           matched_rule, mtime, atime, ext, explain_tmpl)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        [
          scanId, item.path, item.size_bytes, item.category, item.risk_level,
          item.default_action, item.matched_rule, item.mtime, item.atime, item.ext, item.explain
        ]
      )
    }

    const result = await this.engine.scan(existingRoots, {
      maxDepth: SCAN_DEPTH[type],
      excludedDirs,
      largeFileMinBytes: type === 'deep' ? LARGE_FILE_MIN_BYTES : undefined,
      signal: this.signal,
      onBatch: (items) => items.forEach(insertItem),
      onProgress: (p: ScanProgress) => {
        if (!sender.isDestroyed()) sender.send('scan:progress', p)
      }
    })

    this.db.run(
      `UPDATE scans SET finished_at=?, status=?, total_files=?, safe_bytes=?,
         migratable_bytes=?, highrisk_bytes=? WHERE id=?`,
      [
        new Date().toISOString(),
        result.cancelled ? 'cancelled' : 'done',
        result.total_files,
        result.safe_bytes,
        result.migratable_bytes,
        result.highrisk_bytes,
        scanId
      ]
    )
    this.db.logOperation({
      ts: new Date().toISOString(),
      op_type: 'scan',
      action: type,
      status: result.cancelled ? 'skipped' : 'success',
      size_bytes: result.safe_bytes + result.migratable_bytes
    })
    this.db.flush()
    this.signal = null

    return {
      scanId,
      total_files: result.total_files,
      safe_bytes: result.safe_bytes,
      migratable_bytes: result.migratable_bytes,
      highrisk_bytes: result.highrisk_bytes,
      elapsed_ms: result.elapsed_ms,
      cancelled: result.cancelled,
      dir_error_count: result.dir_errors.length
    }
  }

  /** 按分类聚合扫描结果，供结果页分类树展示。 */
  categorySummary(scanId: number): { category: string; risk_level: string; count: number; bytes: number }[] {
    return this.db.query(
      `SELECT category, risk_level, COUNT(*) AS count, SUM(size_bytes) AS bytes
       FROM scan_items WHERE scan_id = ? GROUP BY category, risk_level
       ORDER BY bytes DESC`,
      [scanId]
    )
  }

  items(scanId: number, category?: string, limit = 500): ScanItem[] {
    const sql = category
      ? `SELECT * FROM scan_items WHERE scan_id = ? AND category = ? ORDER BY size_bytes DESC LIMIT ?`
      : `SELECT * FROM scan_items WHERE scan_id = ? ORDER BY size_bytes DESC LIMIT ?`
    const params = category ? [scanId, category, limit] : [scanId, limit]
    return this.db.query<ScanItem>(sql, params)
  }
}
