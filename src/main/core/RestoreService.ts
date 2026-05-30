import { win32 as path } from 'path'
import type { FsAdapter } from './FsAdapter'
import type { ColdItem } from '@shared/types'
import { AppError, ErrorCode } from '@shared/errors'
import { isForbidden } from './forbidden'
import { isDriveRoot, driveLetter, normalizePath } from './pathUtils'
import { resolveColdPath } from './coldPath'

export type RestoreIssue =
  | 'cold_missing'
  | 'forbidden_target'
  | 'parent_missing'
  | 'target_exists'
  | 'insufficient_space'

export interface RestorePrecheck {
  ok: boolean
  issues: RestoreIssue[]
  target_path: string
}

export type ConflictResolution = 'keep_both' | 'overwrite' | 'cancel'

export interface RestoreOptions {
  /** 覆盖默认恢复位置（默认 original_path）。 */
  targetPath?: string
  /** 父目录缺失时是否自动重建（PRD §11.3）。 */
  createParent?: boolean
  /** 目标已存在时的处置（PRD §11.3）。 */
  onConflict?: ConflictResolution
  /** 恢复成功后是否删除冷藏副本（默认 false：保留）。 */
  removeCold?: boolean
}

export interface RestoreResult {
  status: 'done' | 'failed' | 'cancelled'
  error_code?: string
  error_detail?: string
  restored_path?: string
  /** 冷藏文件是否仍存在（不变量：恢复失败必为 true）。 */
  cold_kept: boolean
}

/**
 * 恢复。实现 TECH_DESIGN.md §5.2 状态机：
 * precheck（冷藏存在/禁止目标/父目录/已存在/空间）→ copy_back(.part) → verify(sha256) → remove_cold(可选) → done。
 * 不变量（PRD §11.4 / §5.5）：恢复未成功完成前绝不删除冷藏文件；恢复到系统关键目录被阻止。
 */
export class RestoreService {
  constructor(private readonly fs: FsAdapter) {}

  private targetOf(item: ColdItem, opts: RestoreOptions): string {
    return normalizePath(opts.targetPath ?? item.original_path)
  }

  /** 前置检查，返回阻塞项供 UI 引导用户处置（不做任何写操作）。 */
  async precheck(item: ColdItem, opts: RestoreOptions = {}): Promise<RestorePrecheck> {
    const target = this.targetOf(item, opts)
    const issues: RestoreIssue[] = []

    if (isForbidden(target) || isDriveRoot(target)) issues.push('forbidden_target')
    if (!(await this.fs.exists(item.cold_path))) issues.push('cold_missing')

    const parent = path.dirname(target)
    if (!(await this.fs.exists(parent))) issues.push('parent_missing')
    if (await this.fs.exists(target)) issues.push('target_exists')

    try {
      const drive = driveLetter(target)
      if (drive) {
        const { free } = await this.fs.diskSpace(drive + '\\')
        if (free < item.size_bytes) issues.push('insufficient_space')
      }
    } catch {
      // 盘不可达时由实际恢复阶段兜底
    }

    return { ok: issues.length === 0, issues, target_path: target }
  }

  async restore(item: ColdItem, opts: RestoreOptions = {}): Promise<RestoreResult> {
    let target = this.targetOf(item, opts)

    // 1. 禁止恢复到系统关键目录 / 盘根（PRD §11.4，硬阻止，不可覆盖）
    if (isForbidden(target) || isDriveRoot(target)) {
      return { status: 'failed', error_code: ErrorCode.PATH_FORBIDDEN, error_detail: target, cold_kept: true }
    }

    // 2. 冷藏文件必须存在，否则不可恢复（调用方据此标记 restorable=false）
    if (!(await this.fs.exists(item.cold_path))) {
      return { status: 'failed', error_code: ErrorCode.COLD_MISSING, error_detail: item.cold_path, cold_kept: false }
    }

    // 3. 父目录缺失 → 重建或取消
    const parent = path.dirname(target)
    if (!(await this.fs.exists(parent))) {
      if (opts.createParent) {
        await this.fs.mkdirp(parent)
      } else {
        return { status: 'failed', error_code: ErrorCode.PARENT_MISSING, error_detail: parent, cold_kept: true }
      }
    }

    // 4. 目标已存在 → 冲突处置
    if (await this.fs.exists(target)) {
      const res = opts.onConflict
      if (res === 'keep_both') {
        target = await resolveColdPath(parent, path.basename(target), (p) => this.fs.exists(p))
      } else if (res === 'overwrite') {
        await this.fs.unlink(target) // UI 已做二次确认
      } else {
        return { status: 'cancelled', error_code: ErrorCode.DEST_EXISTS, error_detail: target, cold_kept: true }
      }
    }

    // 5. 空间检查
    try {
      const drive = driveLetter(target)
      if (drive) {
        const { free } = await this.fs.diskSpace(drive + '\\')
        if (free < item.size_bytes) {
          return { status: 'failed', error_code: ErrorCode.INSUFFICIENT_SPACE, error_detail: target, cold_kept: true }
        }
      }
    } catch {
      // 忽略，进入复制阶段兜底
    }

    // 6. copy_back → verify → 提交
    const partPath = target + '.part'
    try {
      await this.fs.copyFile(item.cold_path, partPath)
      if (item.checksum) {
        const hash = await this.fs.sha256(partPath)
        if (hash !== item.checksum) {
          await this.fs.unlink(partPath).catch(() => undefined)
          return { status: 'failed', error_code: ErrorCode.CHECKSUM, error_detail: '恢复校验不一致，已回滚', cold_kept: true }
        }
      }
      await this.fs.rename(partPath, target)
    } catch (e) {
      await this.fs.unlink(partPath).catch(() => undefined)
      if (e instanceof AppError) {
        return { status: 'failed', error_code: e.code, error_detail: e.detail, cold_kept: true }
      }
      return { status: 'failed', error_code: ErrorCode.UNKNOWN, error_detail: String(e), cold_kept: true }
    }

    // 7. remove_cold（可选）。删除失败不影响恢复成功（冷藏副本残留仅占空间）。
    let coldKept = true
    if (opts.removeCold) {
      try {
        await this.fs.unlink(item.cold_path)
        coldKept = false
      } catch {
        coldKept = true
      }
    }

    return { status: 'done', restored_path: target, cold_kept: coldKept }
  }
}
