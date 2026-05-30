import type { FsAdapter } from './FsAdapter'
import type { RuleEngine } from './RuleEngine'
import type { ScanItem, ScanProgress, RiskLevel } from '@shared/types'
import { walk } from './Walker'
import { isMigratableLargeFile } from './largeFile'

export interface ScanEngineOptions {
  maxDepth: number
  excludedDirs: string[]
  /** 深度扫描：未匹配规则但 >= 此阈值的文件也作为"大文件"记录 */
  largeFileMinBytes?: number
  signal?: { cancelled: boolean }
  /** 进度回调（调用方负责节流） */
  onProgress?: (p: ScanProgress) => void
  /** 命中项分批回调（用于落库，避免全量驻留） */
  onBatch?: (items: ScanItem[]) => void
  batchSize?: number
  progressIntervalMs?: number
}

export interface ScanResult {
  total_files: number
  safe_bytes: number
  migratable_bytes: number
  highrisk_bytes: number
  elapsed_ms: number
  dir_errors: { dir: string; code: string }[]
  cancelled: boolean
}

/**
 * 扫描编排：遍历根目录 → 逐项分类 → 聚合空间 → 节流进度 → 分批输出命中项。
 * core 纯逻辑，依赖注入 FsAdapter/RuleEngine，可用内存 FS 单测。
 */
export class ScanEngine {
  constructor(
    private readonly fs: FsAdapter,
    private readonly rules: RuleEngine
  ) {}

  async scan(roots: string[], opts: ScanEngineOptions): Promise<ScanResult> {
    const start = Date.now()
    const result: ScanResult = {
      total_files: 0,
      safe_bytes: 0,
      migratable_bytes: 0,
      highrisk_bytes: 0,
      elapsed_ms: 0,
      dir_errors: [],
      cancelled: false
    }

    const batch: ScanItem[] = []
    const batchSize = opts.batchSize ?? 500
    const progressMs = opts.progressIntervalMs ?? 250
    let lastProgress = 0
    let currentDir = ''

    const flushBatch = (): void => {
      if (batch.length > 0) {
        opts.onBatch?.(batch.splice(0, batch.length))
      }
    }

    const emitProgress = (force: boolean): void => {
      const now = Date.now()
      if (!force && now - lastProgress < progressMs) return
      lastProgress = now
      opts.onProgress?.({
        current_dir: currentDir,
        files_scanned: result.total_files,
        safe_bytes: result.safe_bytes,
        migratable_bytes: result.migratable_bytes,
        highrisk_bytes: result.highrisk_bytes,
        elapsed_ms: now - start,
        done: false
      })
    }

    for (const root of roots) {
      if (opts.signal?.cancelled) break

      const iterator = walk(this.fs, root, {
        maxDepth: opts.maxDepth,
        excludedDirs: opts.excludedDirs,
        signal: opts.signal,
        onDirError: (dir, code) => result.dir_errors.push({ dir, code })
      })

      for await (const meta of iterator) {
        if (opts.signal?.cancelled) {
          result.cancelled = true
          break
        }
        result.total_files++
        currentDir = meta.is_dir ? meta.path : currentDir

        if (meta.is_dir) {
          emitProgress(false)
          continue
        }

        const c = this.rules.classify(meta)
        const isLarge =
          opts.largeFileMinBytes !== undefined &&
          c.matched_rule === null &&
          meta.size_bytes >= opts.largeFileMinBytes &&
          // 排除可执行/动态库/模型/运行时组件：迁走会破坏应用（如剪映报错 1354）
          isMigratableLargeFile(meta.path, meta.ext)

        const record = c.default_action !== 'none' || c.risk_level === 'high' || isLarge
        if (record) {
          const item: ScanItem = {
            path: meta.path,
            size_bytes: meta.size_bytes,
            mtime: meta.mtime,
            atime: meta.atime,
            ext: meta.ext,
            category: isLarge ? 'media_video' : c.category,
            risk_level: isLarge ? 'low' : c.risk_level,
            default_action: isLarge ? 'migrate' : c.default_action,
            matched_rule: isLarge ? '__large_file__' : c.matched_rule,
            explain: isLarge ? '大文件（未匹配已知缓存规则），可考虑迁移冷藏。' : c.explain,
            delete_policy: isLarge ? 'delete_self' : c.delete_policy
          }
          this.accumulate(result, item.risk_level, item.default_action, item.size_bytes)
          batch.push(item)
          if (batch.length >= batchSize) flushBatch()
        }

        emitProgress(false)
      }
    }

    flushBatch()
    result.elapsed_ms = Date.now() - start
    if (opts.signal?.cancelled) result.cancelled = true

    opts.onProgress?.({
      current_dir: '',
      files_scanned: result.total_files,
      safe_bytes: result.safe_bytes,
      migratable_bytes: result.migratable_bytes,
      highrisk_bytes: result.highrisk_bytes,
      elapsed_ms: result.elapsed_ms,
      done: true
    })

    return result
  }

  private accumulate(
    r: ScanResult,
    risk: RiskLevel,
    action: string,
    bytes: number
  ): void {
    if (action === 'clean' && (risk === 'safe' || risk === 'low')) r.safe_bytes += bytes
    else if (action === 'migrate') r.migratable_bytes += bytes
    if (risk === 'high') r.highrisk_bytes += bytes
  }
}
