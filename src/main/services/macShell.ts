import { execFile } from 'child_process'

/** 读取挂载点的卷 UUID（用于识别外接备份盘是否被更换，对应 Windows 的卷序列号）。失败返回 null。 */
export function getVolumeUUID(mount: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') {
      resolve(null)
      return
    }
    execFile('diskutil', ['info', '-plist', mount], (err, stdout) => {
      if (err) {
        resolve(null)
        return
      }
      const m = String(stdout).match(/<key>VolumeUUID<\/key>\s*<string>([^<]+)<\/string>/)
      resolve(m ? m[1] : null)
    })
  })
}

/** 通过 Finder 清空废纸篓（对应 Windows 的清空回收站）。不直接删 ~/.Trash。 */
export function emptyTrash(): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') {
      resolve({ ok: false, error: '仅支持 macOS' })
      return
    }
    execFile('osascript', ['-e', 'tell application "Finder" to empty trash'], (err) => {
      if (err) resolve({ ok: false, error: String(err.message || err) })
      else resolve({ ok: true })
    })
  })
}
