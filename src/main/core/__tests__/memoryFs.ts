import type { FsAdapter } from '../FsAdapter'
import type { FileMeta } from '@shared/types'
import { AppError, ErrorCode } from '@shared/errors'

export interface MemEntry {
  size?: number
  mtime?: string
  atime?: string
  isDir?: boolean
  isSymlink?: boolean
  locked?: boolean
  content?: string
}

/**
 * 内存文件系统，用于 core 单测。保留原始大小写，按大小写不敏感查找，
 * readdir 去重并返回原始大小写的直接子项名（贴近真实 fs 行为）。
 */
export class MemoryFsAdapter implements FsAdapter {
  private entries = new Map<string, MemEntry>() // key: 原始路径
  private index = new Map<string, string>() // upper -> 原始路径

  set(path: string, e: MemEntry): void {
    this.entries.set(path, e)
    this.index.set(path.toUpperCase(), path)
  }

  private get(path: string): MemEntry | undefined {
    const orig = this.index.get(path.toUpperCase())
    return orig ? this.entries.get(orig) : undefined
  }

  private del(path: string): void {
    const up = path.toUpperCase()
    const orig = this.index.get(up)
    if (orig) this.entries.delete(orig)
    this.index.delete(up)
  }

  async lstat(path: string): Promise<FileMeta> {
    const e = this.get(path)
    if (!e) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
    return {
      path,
      size_bytes: e.size ?? 0,
      mtime: e.mtime ?? null,
      atime: e.atime ?? null,
      ext: '.' + (path.split('.').pop() ?? ''),
      is_dir: !!e.isDir,
      is_symlink: !!e.isSymlink
    }
  }

  async exists(path: string): Promise<boolean> {
    return this.index.has(path.toUpperCase())
  }

  async readdir(path: string): Promise<string[]> {
    const prefixUpper = path.toUpperCase() + '\\'
    const children = new Set<string>()
    for (const orig of this.entries.keys()) {
      if (orig.toUpperCase().startsWith(prefixUpper)) {
        const rest = orig.slice(path.length + 1)
        children.add(rest.split('\\')[0])
      }
    }
    return [...children]
  }

  async isLocked(path: string): Promise<boolean> {
    return !!this.get(path)?.locked
  }

  async copyFile(src: string, dest: string): Promise<void> {
    const e = this.get(src)
    if (!e) throw new Error(`ENOENT: ${src}`)
    this.set(dest, { ...e })
  }

  async rename(src: string, dest: string): Promise<void> {
    const e = this.get(src)
    if (!e) throw new Error(`ENOENT: ${src}`)
    this.set(dest, e)
    this.del(src)
  }

  async unlink(path: string): Promise<void> {
    // 真实 fs 删除被占用文件会抛 EBUSY → FILE_LOCKED；清理路径已不预检占用，
    // 故由 unlink 自行翻译，保持与 NodeFsAdapter 一致。
    if (this.get(path)?.locked) throw new AppError(ErrorCode.FILE_LOCKED, path)
    this.del(path)
  }

  async mkdirp(path: string): Promise<void> {
    this.set(path, { isDir: true })
  }

  async sha256(path: string): Promise<string> {
    const e = this.get(path)
    return 'sha256:' + (e?.content ?? e?.size ?? '0')
  }

  async diskSpace(): Promise<{ free: number; total: number }> {
    return { free: 100 * 1024 ** 3, total: 500 * 1024 ** 3 }
  }
}
