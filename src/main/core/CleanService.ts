import type { FsAdapter } from './FsAdapter'
import type { SafetyGuard } from './SafetyGuard'
import type { ScanItem } from '@shared/types'
import { AppError, ErrorCode } from '@shared/errors'

export interface CleanLogEntry {
  path: string
  size_bytes: number
  category: string
  risk_level: string
  status: 'success' | 'skipped' | 'failed'
  error_code?: string
  error_detail?: string
}

export interface CleanOptions {
  signal?: { cancelled: boolean }
  onLog?: (e: CleanLogEntry) => void
  /** 并发删除度（IO 密集，默认 16）。 */
  concurrency?: number
}

export interface CleanReport {
  freed_bytes: number
  cleaned: number
  skipped: number
  failed: number
  details: CleanLogEntry[]
}

/**
 * 安全清理：只删除 safe 项的具体文件。每个文件删除前必过 SafetyGuard（TDD §7）。
 * 高风险/禁止项硬拒绝；占用/无权限跳过不重试（PRD §17.2）。
 * core 纯逻辑，依赖注入 FsAdapter/SafetyGuard，可单测。
 */
export class CleanService {
  constructor(
    private readonly fs: FsAdapter,
    private readonly guard: SafetyGuard
  ) {}

  async clean(items: ScanItem[], opts: CleanOptions = {}): Promise<CleanReport> {
    const report: CleanReport = { freed_bytes: 0, cleaned: 0, skipped: 0, failed: 0, details: [] }

    const log = (
      item: ScanItem,
      status: CleanLogEntry['status'],
      error_code?: string,
      error_detail?: string
    ): void => {
      const entry: CleanLogEntry = {
        path: item.path,
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
        report.cleaned++
        report.freed_bytes += item.size_bytes
      } else if (status === 'skipped') report.skipped++
      else report.failed++
    }

    const handle = async (item: ScanItem): Promise<void> => {
      // 硬规则：只允许清理 safe/low 且建议清理的项
      if (item.risk_level === 'high' || item.risk_level === 'forbidden') {
        log(item, 'skipped', ErrorCode.PATH_FORBIDDEN, '高风险/禁止项不允许一键清理')
        return
      }
      if (item.default_action !== 'clean') {
        log(item, 'skipped', undefined, '非清理项（建议迁移或仅展示）')
        return
      }
      try {
        // 复核：根目录/通配/禁止/排除/符号链接。占用不预检——unlink 失败会翻译为 FILE_LOCKED，
        // 省去每文件一次 open/close，批量清理显著提速。
        await this.guard.assertSafe(item.path, { checkLock: false })
        await this.fs.unlink(item.path)
        log(item, 'success')
      } catch (e) {
        // 源文件已不存在（扫描后被系统/应用自动清理）：清理目标已达成，记为跳过而非失败。
        const errno = (e as NodeJS.ErrnoException | undefined)?.code
        if (errno === 'ENOENT') {
          log(item, 'skipped', ErrorCode.SOURCE_GONE, '源文件已不存在（可能已被自动清理）')
        } else if (e instanceof AppError) {
          const skipCodes = [
            ErrorCode.FILE_LOCKED,
            ErrorCode.NO_PERMISSION,
            ErrorCode.PATH_EXCLUDED,
            ErrorCode.SYMLINK_SKIP,
            ErrorCode.PATH_FORBIDDEN,
            ErrorCode.SOURCE_GONE
          ]
          if (skipCodes.includes(e.code)) log(item, 'skipped', e.code, e.detail)
          else log(item, 'failed', e.code, e.detail)
        } else {
          log(item, 'failed', ErrorCode.UNKNOWN, String(e))
        }
      }
    }

    // 有界并发的删除池（IO 密集，串行会很慢）。每个 worker 顺序取下一项。
    const concurrency = Math.max(1, opts.concurrency ?? 16)
    let next = 0
    const worker = async (): Promise<void> => {
      while (true) {
        if (opts.signal?.cancelled) return
        const i = next++
        if (i >= items.length) return
        await handle(items[i])
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))

    return report
  }
}
