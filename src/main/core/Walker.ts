import type { FsAdapter } from './FsAdapter'
import type { FileMeta } from '@shared/types'
import type { PlatformProfile } from './platform'
import { getActiveProfile } from './platform'

export interface WalkOptions {
  maxDepth: number
  excludedDirs: string[]
  /** 取消令牌：置 true 后尽快停止 */
  signal?: { cancelled: boolean }
  /** 无权限/被占用的目录回调（标记而非中断，PRD §7.4） */
  onDirError?: (dir: string, code: string) => void
  /** 平台档，默认按当前平台自动选择。决定路径分隔符与归一化语义。 */
  profile?: PlatformProfile
}

/**
 * 深度优先遍历目录，产出文件与目录的元数据。
 * 安全约束（TDD §7.4）：不跟随符号链接/junction；无权限目录跳过并标记；不读取文件内容。
 * 路径语义经 PlatformProfile 抽象（Windows \ / macOS /）。
 */
export async function* walk(
  fs: FsAdapter,
  root: string,
  opts: WalkOptions
): AsyncGenerator<FileMeta> {
  const p = opts.profile ?? getActiveProfile()
  yield* walkDir(fs, p.normalizePath(root), 0, opts, p)
}

async function* walkDir(
  fs: FsAdapter,
  dir: string,
  depth: number,
  opts: WalkOptions,
  p: PlatformProfile
): AsyncGenerator<FileMeta> {
  if (opts.signal?.cancelled) return
  if (opts.excludedDirs.some((ex) => p.isUnder(ex, dir))) return

  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch (e) {
    opts.onDirError?.(dir, (e as { code?: string }).code ?? 'EUNKNOWN')
    return
  }

  for (const name of names) {
    if (opts.signal?.cancelled) return
    const full = p.path.join(dir, name)

    let meta: FileMeta
    try {
      meta = await fs.lstat(full)
    } catch {
      continue // stat 失败的项跳过
    }

    if (meta.is_symlink) {
      // 不跟随符号链接/junction，但产出其元数据供分类（一般会被规则忽略）
      yield meta
      continue
    }

    if (meta.is_dir) {
      yield meta
      if (depth < opts.maxDepth) {
        yield* walkDir(fs, full, depth + 1, opts, p)
      }
    } else {
      yield meta
    }
  }
}
