import type { Db } from '../infra/Db'
import { NodeFsAdapter } from '@core/NodeFsAdapter'
import { getActiveProfile } from '@core/platform'
import { BackupService } from './BackupService'

export interface OperationRow {
  id: number
  ts: string
  op_type: string
  path: string | null
  dest_path: string | null
  size_bytes: number | null
  category: string | null
  risk_level: string | null
  action: string | null
  status: string
  error_code: string | null
  error_detail: string | null
  user_confirm: string | null
  ai_summary: string | null
  batch_id: string | null
}

export interface ScanSummaryRow {
  id: number
  type: string
  finished_at: string | null
  total_files: number
  safe_bytes: number
  migratable_bytes: number
  highrisk_bytes: number
}

export interface OverviewData {
  system: { free: number; total: number }
  scan: ScanSummaryRow | null
  cold: { count: number; bytes: number }
  backup: { set: boolean; online: boolean; path: string | null; cold_period_days: number }
  recent: OperationRow[]
}

const EXPORT_COLS: (keyof OperationRow)[] = [
  'id', 'ts', 'op_type', 'path', 'dest_path', 'size_bytes', 'category', 'risk_level',
  'action', 'status', 'error_code', 'error_detail', 'user_confirm', 'ai_summary', 'batch_id'
]

/**
 * 首页概览 + 操作记录查询/导出（PRD §6 / §18.2 / §18.6 / §14.3）。
 * 只读聚合，不做任何写操作。
 */
export class StatsService {
  private fs = new NodeFsAdapter()

  constructor(
    private db: Db,
    private backup: BackupService
  ) {}

  /** 首页仪表盘数据：C 盘空间 / 最近扫描 / 冷藏占用 / 备份盘状态 / 最近记录。 */
  async overview(): Promise<OverviewData> {
    let system = { free: 0, total: 0 }
    try {
      system = await this.fs.diskSpace(getActiveProfile().systemAnchor)
    } catch {
      /* 取盘信息失败时返回 0，不阻断概览 */
    }

    const scanRows = this.db.query<ScanSummaryRow>(
      `SELECT id, type, finished_at, total_files, safe_bytes, migratable_bytes, highrisk_bytes
       FROM scans WHERE status = 'done' ORDER BY id DESC LIMIT 1`
    )
    const cold = this.db.query<{ count: number; bytes: number }>(
      `SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes
       FROM cold_items WHERE state = 'active'`
    )[0] ?? { count: 0, bytes: 0 }

    const info = this.backup.get()
    const online = info ? await this.backup.isOnline() : false

    return {
      system,
      scan: scanRows[0] ?? null,
      cold,
      backup: {
        set: !!info,
        online,
        path: info?.path ?? null,
        cold_period_days: info?.cold_period_days ?? 90
      },
      recent: this.operations(undefined, 8)
    }
  }

  /**
   * 操作记录查询。opType 可为具体类型（scan/clean/migrate/restore/delete_cold…）
   * 或 'failed'（仅失败项）或 'all'/undefined（全部）。
   */
  operations(opType?: string, limit = 200): OperationRow[] {
    if (opType && opType !== 'all') {
      if (opType === 'failed') {
        return this.db.query<OperationRow>(
          'SELECT * FROM operations WHERE status = ? ORDER BY id DESC LIMIT ?',
          ['failed', limit]
        )
      }
      return this.db.query<OperationRow>(
        'SELECT * FROM operations WHERE op_type = ? ORDER BY id DESC LIMIT ?',
        [opType, limit]
      )
    }
    return this.db.query<OperationRow>(
      'SELECT * FROM operations ORDER BY id DESC LIMIT ?',
      [limit]
    )
  }

  /** 构造导出文本（JSON / CSV）。供主进程写入用户选择的文件。 */
  buildExport(format: 'json' | 'csv', opType?: string): string {
    const rows = this.operations(opType, 1000000)
    if (format === 'json') return JSON.stringify(rows, null, 2)
    const head = EXPORT_COLS.join(',')
    const body = rows.map((r) => EXPORT_COLS.map((c) => csvCell(r[c])).join(',')).join('\r\n')
    return `${head}\r\n${body}`
  }
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
