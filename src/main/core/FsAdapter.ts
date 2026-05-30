import type { FileMeta } from '@shared/types'

/**
 * 文件系统抽象。core 只依赖此接口，不直接 import fs，
 * 以便单元测试用内存实现替换（TECH_DESIGN.md §2 可移植原则）。
 */
export interface FsAdapter {
  /** lstat：不跟随符号链接 */
  lstat(path: string): Promise<FileMeta>
  exists(path: string): Promise<boolean>
  readdir(path: string): Promise<string[]>
  /** 尝试以独占方式打开以检测占用，被占用返回 false */
  isLocked(path: string): Promise<boolean>
  copyFile(src: string, dest: string): Promise<void>
  rename(src: string, dest: string): Promise<void>
  unlink(path: string): Promise<void>
  mkdirp(path: string): Promise<void>
  /** 返回文件 sha256（用于迁移前后校验） */
  sha256(path: string): Promise<string>
  /** 磁盘剩余 / 总容量（字节） */
  diskSpace(anyPathOnDrive: string): Promise<{ free: number; total: number }>
}
