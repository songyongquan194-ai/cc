import { randomUUID } from 'crypto'
import type { FsAdapter } from './FsAdapter'
import type { SafetyGuard } from './SafetyGuard'
import type { ColdItem, ScanItem } from '@shared/types'
import { AppError, ErrorCode } from '@shared/errors'
import type { PlatformProfile } from './platform'
import { getActiveProfile } from './platform'
import { coldItemDir, resolveColdPath, expiresAt } from './coldPath'

export interface MigrateLogEntry {
  path: string
  dest_path?: string
  size_bytes: number
  category: string
  risk_level: string
  status: 'success' | 'source_kept' | 'skipped' | 'failed'
  error_code?: string
  error_detail?: string
}

export interface MigrateOptions {
  coldRoot: string
  periodDays: number
  signal?: { cancelled: boolean }
  now?: Date
  onItem?: (c: ColdItem) => void
  onLog?: (e: MigrateLogEntry) => void
}

export interface MigrateReport {
  /** C 盘实际释放（源已删除的项合计） */
  freed_bytes: number
  /** 备份盘实际占用（已提交到冷藏区的项合计） */
  backup_used_bytes: number
  migrated: number
  source_kept: number
  skipped: number
  failed: number
  details: MigrateLogEntry[]
  cold_items: ColdItem[]
}

/**
 * 迁移/冷藏。实现 TECH_DESIGN.md §5.1 状态机：
 * precheck → copy(.part) → verify(sha256) → commit(rename + ColdItem) → delete_source。
 * 不变量（PRD §10.5）：源文件仅在校验通过且 commit 完成后才删除；任一前置步骤失败源文件保持不变。
 * core 纯逻辑，依赖注入 FsAdapter/SafetyGuard，可单测。
 */
export class MigrateService {
  private readonly p: PlatformProfile

  constructor(
    private readonly fs: FsAdapter,
    private readonly guard: SafetyGuard,
    profile?: PlatformProfile
  ) {
    this.p = profile ?? getActiveProfile()
  }

  async migrate(items: ScanItem[], opts: MigrateOptions): Promise<MigrateReport> {
    const report: MigrateReport = {
      freed_bytes: 0,
      backup_used_bytes: 0,
      migrated: 0,
      source_kept: 0,
      skipped: 0,
      failed: 0,
      details: [],
      cold_items: []
    }
    const now = opts.now ?? new Date()

    for (const item of items) {
      if (opts.signal?.cancelled) break

      const emit = (
        status: MigrateLogEntry['status'],
        dest_path?: string,
        error_code?: string,
        error_detail?: string
      ): void => {
        const entry: MigrateLogEntry = {
          path: item.path,
          dest_path,
          size_bytes: item.size_bytes,
          category: item.category,
          risk_level: item.risk_level,
          status,
          error_code,
          error_detail
        }
        report.details.push(entry)
        opts.onLog?.(entry)
        if (status === 'success') {
          report.migrated++
          report.freed_bytes += item.size_bytes
          report.backup_used_bytes += item.size_bytes
        } else if (status === 'source_kept') {
          report.source_kept++
          report.backup_used_bytes += item.size_bytes
        } else if (status === 'skipped') report.skipped++
        else report.failed++
      }

      // 只迁移建议迁移的项；高风险/禁止不进迁移（守住底线）
      if (item.default_action !== 'migrate') {
        emit('skipped', undefined, undefined, '非迁移项')
        continue
      }
      if (item.risk_level === 'high' || item.risk_level === 'forbidden') {
        emit('skipped', undefined, ErrorCode.PATH_FORBIDDEN, '高风险/禁止项不迁移')
        continue
      }

      // 扫描快照与点击迁移之间可能已过去一段时间：临时/缓存文件常被系统或应用自动删除。
      // 源已不存在属正常情况，记为"跳过"而非"失败"，避免报告里堆出吓人的失败数。
      if (!(await this.fs.exists(item.path))) {
        emit('skipped', undefined, ErrorCode.SOURCE_GONE, '源文件已不存在（可能已被自动清理）')
        continue
      }

      let partPath: string | null = null
      try {
        // 1. precheck：源安全（符号链接/占用/禁止/排除）
        await this.guard.assertSafe(item.path)

        // 2. 目标路径：<coldRoot>\<日期>\<分类>\<防重名文件>
        const dir = coldItemDir(this.p.path, opts.coldRoot, item.category, now)
        const coldPath = await resolveColdPath(this.p.path, dir, this.p.path.basename(item.path), (p) =>
          this.fs.exists(p)
        )
        this.guard.assertValidBackupTarget(coldPath) // 非 C 盘、非系统目录
        await this.fs.mkdirp(dir)

        // 3. copy 到临时 .part
        partPath = coldPath + '.part'
        await this.fs.copyFile(item.path, partPath)

        // 4. verify：源/目标 sha256 比对
        const srcHash = await this.fs.sha256(item.path)
        const dstHash = await this.fs.sha256(partPath)
        if (srcHash !== dstHash) {
          await this.fs.unlink(partPath).catch(() => undefined) // 回滚临时文件
          // 多数源于源文件在复制期间被应用写入（正在使用），属正常情况：跳过并保留源，不计失败。
          emit('skipped', undefined, ErrorCode.CHECKSUM, '源文件在迁移期间发生变化（正在使用），已跳过，源文件保留')
          continue
        }

        // 5. commit：.part 改名为正式名 + 生成 ColdItem
        await this.fs.rename(partPath, coldPath)
        const cold: ColdItem = {
          id: randomUUID(),
          original_path: item.path,
          cold_path: coldPath,
          size_bytes: item.size_bytes,
          category: item.category,
          risk_level: item.risk_level,
          mtime: item.mtime,
          migrated_at: now.toISOString(),
          reason: item.explain || null,
          explain: item.explain || null,
          checksum: srcHash,
          cold_period_days: opts.periodDays,
          expires_at: expiresAt(now, opts.periodDays),
          state: 'active',
          restorable: true
        }
        report.cold_items.push(cold)
        opts.onItem?.(cold)

        // 6. delete_source：失败则保留源（警告，不回滚冷藏）
        try {
          await this.fs.unlink(item.path)
          emit('success', coldPath)
        } catch (e) {
          const detail = e instanceof AppError ? e.detail : String(e)
          emit('source_kept', coldPath, ErrorCode.FILE_LOCKED, '已冷藏但源文件删除失败：' + detail)
        }
      } catch (e) {
        // copy/precheck 阶段失败：清理可能产生的 .part，源文件不动
        if (partPath) await this.fs.unlink(partPath).catch(() => undefined)
        // 竞态：exists 通过后、lstat/copy 前源被删除 → 原生 ENOENT，按"源已消失"跳过。
        const errno = (e as NodeJS.ErrnoException | undefined)?.code
        if (errno === 'ENOENT') {
          emit('skipped', undefined, ErrorCode.SOURCE_GONE, '源文件已不存在（可能已被自动清理）')
        } else if (e instanceof AppError) {
          const skipCodes = [
            ErrorCode.FILE_LOCKED,
            ErrorCode.NO_PERMISSION,
            ErrorCode.PATH_EXCLUDED,
            ErrorCode.SYMLINK_SKIP,
            ErrorCode.PATH_FORBIDDEN,
            ErrorCode.SOURCE_GONE
          ]
          if (skipCodes.includes(e.code)) emit('skipped', undefined, e.code, e.detail)
          else emit('failed', undefined, e.code, e.detail)
        } else {
          emit('failed', undefined, ErrorCode.UNKNOWN, String(e))
        }
      }
    }

    return report
  }
}
