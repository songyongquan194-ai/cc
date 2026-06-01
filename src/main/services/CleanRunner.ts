import type { WebContents } from 'electron'
import type { Db } from '../infra/Db'
import type { ScanItem } from '@shared/types'
import { NodeFsAdapter } from '@core/NodeFsAdapter'
import { SafetyGuard } from '@core/SafetyGuard'
import { CleanService, type CleanReport, type CleanLogEntry } from '@core/CleanService'
import { emptyTrash } from './platformShell'

export interface CleanRunOptions {
  scanId: number
  /** 用户勾选的具体路径；未提供则清理该扫描全部 safe/clean 项。 */
  paths?: string[]
}

/**
 * 清理服务：从 scan_items 取可清理项 → SafetyGuard 复核 → CleanService 删除 → 逐项写 operations 日志。
 * 仅处理 risk_level∈{safe,low} 且 default_action=clean 的项（CleanService 内还会硬复核）。
 */
export class CleanRunner {
  private fs = new NodeFsAdapter()
  private signal: { cancelled: boolean } | null = null

  constructor(private db: Db) {}

  cancel(): void {
    if (this.signal) this.signal.cancelled = true
  }

  /** 预览：列出该扫描可被一键清理的项（供 UI 勾选与确认）。 */
  preview(scanId: number): ScanItem[] {
    return this.db.query<ScanItem>(
      `SELECT path, size_bytes, category, risk_level, default_action,
              matched_rule, mtime, atime, ext, explain_tmpl AS explain
       FROM scan_items
       WHERE scan_id = ? AND risk_level IN ('safe','low') AND default_action = 'clean'
       ORDER BY size_bytes DESC`,
      [scanId]
    )
  }

  async run(opts: CleanRunOptions, sender?: WebContents): Promise<CleanReport> {
    const all = this.preview(opts.scanId)
    const items =
      opts.paths && opts.paths.length
        ? all.filter((i) => opts.paths!.includes(i.path))
        : all

    const excludedDirs = this.db.getSetting<string[]>('excluded_dirs', [])
    const guard = new SafetyGuard(this.fs, { excludedDirs, systemDrive: 'C:' })
    const svc = new CleanService(this.fs, guard)

    this.signal = { cancelled: false }
    const batchId = `clean-${Date.now()}`
    const total = items.length

    // 进度节流：逐项写日志，但聚合后约每 150ms 推一次，避免上万条 IPC 刷爆渲染层。
    let processed = 0
    let freed = 0
    let cleaned = 0
    let skipped = 0
    let failed = 0
    let lastSent = 0
    const sendProgress = (force: boolean): void => {
      const now = Date.now()
      if (!force && now - lastSent < 150) return
      lastSent = now
      if (sender && !sender.isDestroyed()) {
        sender.send('clean:progress', {
          processed, total, freed_bytes: freed, cleaned, skipped, failed
        })
      }
    }

    const report = await svc.clean(items, {
      signal: this.signal,
      onLog: (e: CleanLogEntry) => {
        this.db.logOperation({
          ts: new Date().toISOString(),
          op_type: 'clean',
          path: e.path,
          size_bytes: e.size_bytes,
          category: e.category,
          risk_level: e.risk_level,
          action: 'clean',
          status: e.status,
          error_code: e.error_code,
          error_detail: e.error_detail,
          user_confirm: 'normal',
          batch_id: batchId
        })
        processed++
        if (e.status === 'success') {
          cleaned++
          freed += e.size_bytes
        } else if (e.status === 'skipped') skipped++
        else failed++
        sendProgress(false)
      }
    })
    sendProgress(true)

    this.db.flush()
    this.signal = null
    return report
  }

  /** 经 Shell API 清空回收站（TDD §4.3），并记一条 operations 日志。 */
  async emptyRecycleBin(): Promise<{ ok: boolean; error?: string }> {
    const res = await emptyTrash()
    this.db.logOperation({
      ts: new Date().toISOString(),
      op_type: 'clean',
      action: 'empty_recyclebin',
      status: res.ok ? 'success' : 'failed',
      error_detail: res.error
    })
    this.db.flush()
    return res
  }
}
