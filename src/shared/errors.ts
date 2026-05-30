// 统一错误码，对应 TECH_DESIGN.md §6。记入 operations.error_code，UI 据此给出替代方案。

export enum ErrorCode {
  NO_BACKUP_DRIVE = 'E_NO_BACKUP_DRIVE',
  BACKUP_LOW_SPACE = 'E_BACKUP_LOW_SPACE',
  PATH_FORBIDDEN = 'E_PATH_FORBIDDEN',
  PATH_EXCLUDED = 'E_PATH_EXCLUDED',
  FILE_LOCKED = 'E_FILE_LOCKED',
  NO_PERMISSION = 'E_NO_PERMISSION',
  CHECKSUM = 'E_CHECKSUM',
  DEST_EXISTS = 'E_DEST_EXISTS',
  COLD_MISSING = 'E_COLD_MISSING',
  PARENT_MISSING = 'E_PARENT_MISSING',
  INSUFFICIENT_SPACE = 'E_INSUFFICIENT_SPACE',
  SYMLINK_SKIP = 'E_SYMLINK_SKIP',
  SOURCE_GONE = 'E_SOURCE_GONE',
  UNKNOWN = 'E_UNKNOWN'
}

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.NO_BACKUP_DRIVE]: '未设置备份盘',
  [ErrorCode.BACKUP_LOW_SPACE]: '备份盘剩余空间低于阈值',
  [ErrorCode.PATH_FORBIDDEN]: '路径命中禁止目录，操作被拒绝',
  [ErrorCode.PATH_EXCLUDED]: '路径命中用户排除目录，已跳过',
  [ErrorCode.FILE_LOCKED]: '文件被占用，已跳过',
  [ErrorCode.NO_PERMISSION]: '无读写权限',
  [ErrorCode.CHECKSUM]: '迁移校验不一致，已回滚，源文件保留',
  [ErrorCode.DEST_EXISTS]: '目标位置已存在同名文件',
  [ErrorCode.COLD_MISSING]: '冷藏文件已丢失，无法恢复',
  [ErrorCode.PARENT_MISSING]: '原路径上级目录不存在',
  [ErrorCode.INSUFFICIENT_SPACE]: '目标磁盘空间不足',
  [ErrorCode.SYMLINK_SKIP]: '命中符号链接/junction，已跳过（不跟随）',
  [ErrorCode.SOURCE_GONE]: '源文件已不存在（可能已被自动清理），已跳过',
  [ErrorCode.UNKNOWN]: '未分类错误'
}

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly detail?: string
  ) {
    super(detail ? `${ERROR_MESSAGES[code]}: ${detail}` : ERROR_MESSAGES[code])
    this.name = 'AppError'
  }
}
