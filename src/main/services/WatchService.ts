import { randomUUID } from 'crypto'
import type { Db } from '../infra/Db'
import type { WatchItem, WatchStatus } from '@shared/types'
import { NodeFsAdapter } from '@core/NodeFsAdapter'

export interface WatchAddInput {
  path: string
  size_bytes?: number | null
  category?: string | null
  reason?: string | null
  periodDays?: number
}

const DAY_MS = 24 * 60 * 60 * 1000

function remindAt(from: Date, periodDays: number): string {
  return new Date(from.getTime() + periodDays * DAY_MS).toISOString()
}

/**
 * 观察列表（PRD §12）：处理用户暂时无法决定的文件，提供到期提醒闭环。
 * 安全边界：本服务绝不移动或删除任何文件，只记录元数据与提醒时间。
 */
export class WatchService {
  private fs = new NodeFsAdapter()

  constructor(private db: Db) {}

  /** 加入观察列表（重复路径则刷新周期与提醒时间，不重复插入）。 */
  async add(input: WatchAddInput): Promise<{ ok: boolean; id: string }> {
    const period = input.periodDays ?? 30
    const now = new Date()
    let lastMtime: string | null = null
    try {
      if (await this.fs.exists(input.path)) lastMtime = (await this.fs.lstat(input.path)).mtime
    } catch {
      /* 取元数据失败不阻断加入 */
    }

    const existing = this.db.query<{ id: string }>(
      'SELECT id FROM watch_items WHERE path = ?',
      [input.path]
    )[0]
    if (existing) {
      this.db.run(
        `UPDATE watch_items SET period_days = ?, remind_at = ?, last_seen_mtime = ?, status = 'watching' WHERE id = ?`,
        [period, remindAt(now, period), lastMtime, existing.id]
      )
      this.db.flush()
      return { ok: true, id: existing.id }
    }

    const id = randomUUID()
    this.db.run(
      `INSERT INTO watch_items(id, path, size_bytes, category, reason, added_at, period_days, remind_at, last_seen_mtime, status)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [
        id, input.path, input.size_bytes ?? null, input.category ?? null, input.reason ?? null,
        now.toISOString(), period, remindAt(now, period), lastMtime, 'watching'
      ]
    )
    this.db.flush()
    return { ok: true, id }
  }

  list(): WatchItem[] {
    return this.db.query<WatchItem>(
      'SELECT * FROM watch_items ORDER BY remind_at ASC'
    )
  }

  /**
   * 刷新状态（PRD §12.3）：文件消失→missing；自加入后被修改→recent（降优先级）；
   * 已过提醒时间→due；否则保持 watching。已 ignored 的不再变更。
   */
  async check(): Promise<WatchItem[]> {
    const now = Date.now()
    const items = this.db.query<WatchItem>('SELECT * FROM watch_items')
    for (const it of items) {
      if (it.status === 'ignored') continue
      let next: WatchStatus = 'watching'
      let curMtime = it.last_seen_mtime
      try {
        if (!(await this.fs.exists(it.path))) {
          next = 'missing'
        } else {
          const meta = await this.fs.lstat(it.path)
          curMtime = meta.mtime
          const changed = it.last_seen_mtime != null && meta.mtime != null && meta.mtime !== it.last_seen_mtime
          if (changed) next = 'recent'
          else if (Date.parse(it.remind_at) <= now) next = 'due'
          else next = 'watching'
        }
      } catch {
        next = 'watching'
      }
      if (next !== it.status || curMtime !== it.last_seen_mtime) {
        this.db.run('UPDATE watch_items SET status = ?, last_seen_mtime = ? WHERE id = ?', [
          next, curMtime, it.id
        ])
      }
    }
    this.db.flush()
    return this.list()
  }

  /** 继续观察：从现在起重新计算提醒时间。 */
  extend(id: string, periodDays: number): { ok: boolean } {
    this.db.run(
      `UPDATE watch_items SET period_days = ?, remind_at = ?, status = 'watching' WHERE id = ?`,
      [periodDays, remindAt(new Date(), periodDays), id]
    )
    this.db.flush()
    return { ok: true }
  }

  ignore(id: string): { ok: boolean } {
    this.db.run(`UPDATE watch_items SET status = 'ignored' WHERE id = ?`, [id])
    this.db.flush()
    return { ok: true }
  }

  remove(id: string): { ok: boolean } {
    this.db.run('DELETE FROM watch_items WHERE id = ?', [id])
    this.db.flush()
    return { ok: true }
  }

  /** 到期待处理数量（供首页/导航角标）。 */
  dueCount(): number {
    return this.db.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM watch_items WHERE status = 'due'`
    )[0].n
  }
}
