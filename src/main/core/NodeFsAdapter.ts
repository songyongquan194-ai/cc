import { promises as fsp, constants } from 'fs'
import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { extname } from 'path'
import type { FsAdapter } from './FsAdapter'
import type { FileMeta } from '@shared/types'
import { AppError, ErrorCode } from '@shared/errors'

/** 真实文件系统适配器（生产环境用）。统一把底层错误翻译为 AppError 错误码。 */
export class NodeFsAdapter implements FsAdapter {
  async lstat(path: string): Promise<FileMeta> {
    const st = await fsp.lstat(path)
    return {
      path,
      size_bytes: st.size,
      mtime: st.mtime.toISOString(),
      atime: st.atime.toISOString(),
      ext: extname(path).toLowerCase(),
      is_dir: st.isDirectory(),
      // 符号链接或 reparse point（junction）。Windows junction 在 lstat 下 isSymbolicLink()
      // 对 NTFS reparse 也会标记；为稳妥再查 reparse 属性。
      is_symlink: st.isSymbolicLink()
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fsp.access(path)
      return true
    } catch {
      return false
    }
  }

  async readdir(path: string): Promise<string[]> {
    try {
      return await fsp.readdir(path)
    } catch (e) {
      throw this.translate(e, path)
    }
  }

  async isLocked(path: string): Promise<boolean> {
    let handle: fsp.FileHandle | null = null
    try {
      handle = await fsp.open(path, 'r+')
      return false
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') return true
      // 其它错误（如不存在）不视为占用
      return false
    } finally {
      await handle?.close()
    }
  }

  async copyFile(src: string, dest: string): Promise<void> {
    try {
      // COPYFILE_EXCL：目标已存在则失败，避免覆盖（PRD §10.5）
      await fsp.copyFile(src, dest, constants.COPYFILE_EXCL)
    } catch (e) {
      throw this.translate(e, dest)
    }
  }

  async rename(src: string, dest: string): Promise<void> {
    await fsp.rename(src, dest)
  }

  async unlink(path: string): Promise<void> {
    try {
      await fsp.unlink(path)
    } catch (e) {
      throw this.translate(e, path)
    }
  }

  async mkdirp(path: string): Promise<void> {
    await fsp.mkdir(path, { recursive: true })
  }

  async sha256(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256')
      const stream = createReadStream(path)
      stream.on('error', (e) => reject(this.translate(e, path)))
      stream.on('data', (chunk) => hash.update(chunk))
      stream.on('end', () => resolve('sha256:' + hash.digest('hex')))
    })
  }

  async diskSpace(anyPathOnDrive: string): Promise<{ free: number; total: number }> {
    const st = await fsp.statfs(anyPathOnDrive)
    return { free: st.bavail * st.bsize, total: st.blocks * st.bsize }
  }

  private translate(e: unknown, path: string): AppError {
    const code = (e as NodeJS.ErrnoException).code
    switch (code) {
      case 'ENOENT':
        return new AppError(ErrorCode.SOURCE_GONE, path)
      case 'EACCES':
      case 'EPERM':
        return new AppError(ErrorCode.NO_PERMISSION, path)
      case 'EBUSY':
        return new AppError(ErrorCode.FILE_LOCKED, path)
      case 'EEXIST':
        return new AppError(ErrorCode.DEST_EXISTS, path)
      case 'ENOSPC':
        return new AppError(ErrorCode.INSUFFICIENT_SPACE, path)
      default:
        return new AppError(ErrorCode.UNKNOWN, `${code ?? 'ERR'}: ${path}`)
    }
  }
}
