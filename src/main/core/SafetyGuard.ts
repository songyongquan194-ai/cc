import { AppError, ErrorCode } from '@shared/errors'
import type { FsAdapter } from './FsAdapter'
import { isForbidden } from './forbidden'
import {
  driveLetter,
  hasWildcard,
  isAbsoluteWin,
  isDriveRoot,
  isUnder,
  normalizePath
} from './pathUtils'

export interface SafetyContext {
  /** 用户排除目录（priority_class 1） */
  excludedDirs: string[]
  /** 备份盘根，迁移目标必须在此盘且非 C 盘 */
  backupDrive?: string | null
  /** 系统盘符，默认 C: */
  systemDrive?: string
}

/**
 * 所有删除/迁移/恢复操作的前置守卫。实现 TECH_DESIGN.md §7 八步校验。
 * 任一步不满足即抛 AppError，调用方据 error_code 记日志并展示替代方案。
 */
export class SafetyGuard {
  constructor(
    private readonly fs: FsAdapter,
    private readonly ctx: SafetyContext
  ) {}

  /** 同步部分：路径形态、根目录、通配、禁止目录、排除目录。 */
  assertSafeSync(rawPath: string): void {
    const p = (rawPath ?? '').trim()
    if (!p) throw new AppError(ErrorCode.UNKNOWN, '空路径')
    if (!isAbsoluteWin(p)) throw new AppError(ErrorCode.UNKNOWN, `非绝对路径: ${rawPath}`)

    const norm = normalizePath(p)
    if (isDriveRoot(norm)) throw new AppError(ErrorCode.PATH_FORBIDDEN, `禁止操作盘根: ${norm}`)
    if (hasWildcard(norm)) throw new AppError(ErrorCode.UNKNOWN, `路径含通配符: ${norm}`)
    if (isForbidden(norm)) throw new AppError(ErrorCode.PATH_FORBIDDEN, norm)

    for (const ex of this.ctx.excludedDirs) {
      if (isUnder(ex, norm)) throw new AppError(ErrorCode.PATH_EXCLUDED, norm)
    }
  }

  /**
   * 完整校验：先同步，再异步检测符号链接与占用。
   * checkLock=false 时跳过占用预检（删除路径用，unlink 失败会自行翻译为 FILE_LOCKED，
   * 省去每个文件一次额外 open/close，显著加快批量清理）。
   */
  async assertSafe(rawPath: string, opts: { checkLock?: boolean } = {}): Promise<void> {
    this.assertSafeSync(rawPath)
    const norm = normalizePath(rawPath)

    const meta = await this.fs.lstat(norm)
    if (meta.is_symlink) throw new AppError(ErrorCode.SYMLINK_SKIP, norm)

    if (opts.checkLock !== false && (await this.fs.isLocked(norm))) {
      throw new AppError(ErrorCode.FILE_LOCKED, norm)
    }
  }

  /** 迁移目标盘校验：非 C 盘、非系统目录。 */
  assertValidBackupTarget(destPath: string): void {
    const sysDrive = (this.ctx.systemDrive || 'C:').toUpperCase()
    const dest = normalizePath(destPath)
    const destDrive = driveLetter(dest)
    if (!destDrive) throw new AppError(ErrorCode.UNKNOWN, `无法解析目标盘符: ${destPath}`)
    if (destDrive === sysDrive) {
      throw new AppError(ErrorCode.PATH_FORBIDDEN, `备份目标不能在系统盘 ${sysDrive}`)
    }
    if (isForbidden(dest)) throw new AppError(ErrorCode.PATH_FORBIDDEN, dest)
  }
}
