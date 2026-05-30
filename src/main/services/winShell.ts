import { execFile } from 'child_process'

/** 读取盘符卷序列号（用于识别外接备份盘是否被更换，PRD §5.3）。失败返回 null。 */
export function getVolumeSerial(driveLetter: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(null)
      return
    }
    const letter = driveLetter.replace(/[:\\]/g, '').toUpperCase()
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${letter}:'").VolumeSerialNumber`
      ],
      { windowsHide: true },
      (err, stdout) => {
        if (err) resolve(null)
        else {
          const s = String(stdout).trim()
          resolve(s || null)
        }
      }
    )
  })
}

/** 通过 PowerShell Clear-RecycleBin 清空回收站（不直接删 $Recycle.Bin，TDD §4.3/§7）。 */
export function emptyRecycleBin(): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ ok: false, error: '仅支持 Windows' })
      return
    }
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Clear-RecycleBin -Force -ErrorAction Stop'],
      { windowsHide: true },
      (err) => {
        if (err) {
          // 回收站为空时 Clear-RecycleBin 也会报错，视为成功
          const msg = String(err.message || err)
          if (/empty/i.test(msg)) resolve({ ok: true })
          else resolve({ ok: false, error: msg })
        } else {
          resolve({ ok: true })
        }
      }
    )
  })
}
