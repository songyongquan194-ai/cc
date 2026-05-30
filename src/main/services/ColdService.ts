import type { Db } from '../infra/Db'
import type { ColdItem } from '@shared/types'
import { NodeFsAdapter } from '@core/NodeFsAdapter'
import { expiresAt } from '@core/coldPath'
import { updateManifestState, readManifest, writeManifest } from '../infra/manifest'
import { BackupService } from './BackupService'

interface ColdRow extends Omit<ColdItem, 'restorable'> {
  restorable: number
}

function rowToCold(r: ColdRow): ColdItem {
  return { ...r, restorable: !!r.restorable }
}

/** 冷藏区管理：列表 / 永久删除 / 延长冷藏周期（PRD §18.4，恢复见 M5 RestoreService）。 */
export class ColdService {
  private fs = new NodeFsAdapter()

  constructor(
    private db: Db,
    private backup: BackupService
  ) {}

  list(): ColdItem[] {
    const rows = this.db.query<ColdRow>(
      "SELECT * FROM cold_items WHERE state = 'active' ORDER BY migrated_at DESC"
    )
    return rows.map(rowToCold)
  }

  private getOne(id: string): ColdRow | undefined {
    return this.db.query<ColdRow>('SELECT * FROM cold_items WHERE id = ?', [id])[0]
  }

  /** 永久删除冷藏文件（PRD §15 需强确认，UI 负责）。删除文件 + 标记 deleted + manifest 同步。 */
  async deletePermanently(id: string): Promise<{ ok: boolean; error?: string }> {
    const row = this.getOne(id)
    if (!row) return { ok: false, error: '冷藏项不存在' }
    try {
      if (await this.fs.exists(row.cold_path)) await this.fs.unlink(row.cold_path)
    } catch (e) {
      return { ok: false, error: String(e) }
    }
    this.db.run('UPDATE cold_items SET state = ?, restorable = 0 WHERE id = ?', ['deleted', id])
    const info = this.backup.get()
    if (info) updateManifestState(info.cold_root, id, 'deleted', false)
    this.db.logOperation({
      ts: new Date().toISOString(),
      op_type: 'delete_cold',
      path: row.cold_path,
      size_bytes: row.size_bytes,
      category: row.category,
      action: 'delete_cold',
      status: 'success',
      user_confirm: 'strong'
    })
    this.db.flush()
    return { ok: true }
  }

  /** 延长冷藏周期：自迁入时间重算到期（periodDays<=0 永久）。 */
  extend(id: string, periodDays: number): { ok: boolean; error?: string; expires_at?: string | null } {
    const row = this.getOne(id)
    if (!row) return { ok: false, error: '冷藏项不存在' }
    const exp = expiresAt(new Date(row.migrated_at), periodDays)
    this.db.run('UPDATE cold_items SET cold_period_days = ?, expires_at = ? WHERE id = ?', [
      periodDays,
      exp,
      id
    ])
    const info = this.backup.get()
    if (info) {
      const m = readManifest(info.cold_root)
      const it = m.items.find((i) => i.id === id)
      if (it) {
        it.cold_period_days = periodDays
        it.expires_at = exp
        writeManifest(info.cold_root, m)
      }
    }
    this.db.flush()
    return { ok: true, expires_at: exp }
  }
}
