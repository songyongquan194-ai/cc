// 平台系统操作分派：卷标识读取 + 清空回收站/废纸篓。按 process.platform 选实现。
import { getVolumeSerial, emptyRecycleBin } from './winShell'
import { getVolumeUUID, emptyTrash as macEmptyTrash } from './macShell'

/** 读取卷标识（Windows: 卷序列号；macOS: 卷 UUID）。失败返回 null。 */
export function getVolumeId(mountOrDrive: string): Promise<string | null> {
  return process.platform === 'darwin' ? getVolumeUUID(mountOrDrive) : getVolumeSerial(mountOrDrive)
}

/** 清空系统回收站/废纸篓（Windows: 回收站；macOS: 废纸篓）。 */
export function emptyTrash(): Promise<{ ok: boolean; error?: string }> {
  return process.platform === 'darwin' ? macEmptyTrash() : emptyRecycleBin()
}
