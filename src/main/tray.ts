import { Tray, Menu, nativeImage, Notification } from 'electron'

// 16x16 托盘图标（运行时从 base64 解码，免去打包二进制资源）。
const ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAARklEQVR4nGNgQAISE/7/JwYzYAPEasZqCKmaUQwhVzPcEGyC2ADRBuBSjEucaAModsEwMIDoQKQ4GklOSBQnZapkJkqyMwBcDH6bmDAfpQAAAABJRU5ErkJggg=='

let tray: Tray | null = null

export interface TrayHandlers {
  onOpen: () => void
  onQuit: () => void
}

/** 创建托盘（幂等）。仅在用户开启「最小化到托盘」时调用。 */
export function ensureTray(handlers: TrayHandlers): Tray {
  if (tray) return tray
  const icon = nativeImage.createFromDataURL(ICON_DATA_URL)
  tray = new Tray(icon)
  tray.setToolTip('C 盘安全清理与文件冷藏')
  const menu = Menu.buildFromTemplate([
    { label: '打开主界面', click: () => handlers.onOpen() },
    { type: 'separator' },
    { label: '退出', click: () => handlers.onQuit() }
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => handlers.onOpen())
  return tray
}

/** 更新托盘提示与到期角标文案。 */
export function updateTrayTooltip(dueCount: number): void {
  if (!tray) return
  tray.setToolTip(
    dueCount > 0
      ? `C 盘安全清理 · ${dueCount} 个观察项已到期`
      : 'C 盘安全清理与文件冷藏'
  )
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}

/** 到期提醒（仅本地系统通知，不联网、不常驻监控）。 */
export function notifyDue(dueCount: number, onClick: () => void): void {
  if (dueCount <= 0 || !Notification.isSupported()) return
  const n = new Notification({
    title: '观察列表到期提醒',
    body: `有 ${dueCount} 个观察项已到期，建议处理（继续观察 / 迁移冷藏 / 忽略）。`
  })
  n.on('click', onClick)
  n.show()
}
