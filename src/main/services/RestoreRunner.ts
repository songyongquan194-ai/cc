import type { Db } from '../infra/Db'
import type { ColdItem } from '@shared/types'
import { NodeFsAdapter } from '@core/NodeFsAdapter'
import {
  RestoreService,
  type RestoreOptions,
  type RestoreResult,
  type RestorePrecheck
} from '@core/RestoreService'
import { updateManifestState } from '../infra/manifest'
import { BackupService } from './BackupService'

interface ColdRow extends Omit<ColdItem, 'restorable'> {
  restorable: number
}

function rowToCold(r: ColdRow): ColdItem {
  return { ...r, restorable: !!r.restorable }
}

/** 恢复编排：加载 cold_items → RestoreService 执行 → 更新 cold_items/manifest 状态 + operations 日志。 */
export class RestoreRunner {
  private fs = new NodeFsAdapter()
  private svc = new RestoreService(this.fs)

  constructor(
    private db: Db,
    private backup: BackupService
  ) {}

  private load(id: string): ColdItem | null {
    const row = this.db.query<ColdRow>('SELECT * FROM cold_items WHERE id = ?', [id])[0]
    return row ? rowToCold(row) : null
  }

  async precheck(id: string, targetPath?: string): Promise<RestorePrecheck & { found: boolean }> {
    const item = this.load(id)
    if (!item) return { found: false, ok: false, issues: [], target_path: '' }
    const pc = await this.svc.precheck(item, { targetPath })
    // 冷藏丢失：标记不可恢复（不变量 PRD §11.4 不删任何东西，仅标记）
    if (pc.issues.includes('cold_missing')) this.markUnrestorable(item.id)
    return { found: true, ...pc }
  }

  async run(id: string, opts: RestoreOptions = {}): Promise<RestoreResult & { found: boolean }> {
    const item = this.load(id)
    if (!item) return { found: false, status: 'failed', error_code: 'E_UNKNOWN', cold_kept: true }

    const result = await this.svc.restore(item, opts)

    if (result.status === 'done') {
      // 冷藏副本若已删除则不再可恢复；保留则状态置为 restored
      this.db.run('UPDATE cold_items SET state = ?, restorable = ? WHERE id = ?', [
        'restored',
        result.cold_kept ? 1 : 0,
        id
      ])
      const info = this.backup.get()
      if (info) updateManifestState(info.cold_root, id, 'restored', result.cold_kept)
    } else if (result.error_code === 'E_COLD_MISSING') {
      this.markUnrestorable(id)
    }

    this.db.logOperation({
      ts: new Date().toISOString(),
      op_type: 'restore',
      path: result.restored_path ?? item.original_path,
      dest_path: result.restored_path,
      size_bytes: item.size_bytes,
      category: item.category,
      risk_level: item.risk_level,
      action: 'restore',
      status: result.status === 'done' ? 'success' : result.status === 'cancelled' ? 'skipped' : 'failed',
      error_code: result.error_code,
      error_detail: result.error_detail,
      user_confirm: opts.onConflict === 'overwrite' ? 'double' : 'normal'
    })
    this.db.flush()
    return { found: true, ...result }
  }

  private markUnrestorable(id: string): void {
    this.db.run('UPDATE cold_items SET state = ?, restorable = 0 WHERE id = ?', ['missing', id])
    const info = this.backup.get()
    if (info) updateManifestState(info.cold_root, id, 'missing', false)
    this.db.flush()
  }
}
