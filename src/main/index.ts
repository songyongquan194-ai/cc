import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { createRequire } from 'module'
import { ensureTray, destroyTray, updateTrayTooltip, notifyDue } from './tray'
import { Db } from './infra/Db'
import { ScanService } from './services/ScanService'
import { CleanRunner, type CleanRunOptions } from './services/CleanRunner'
import { BackupService } from './services/BackupService'
import { MigrateRunner } from './services/MigrateRunner'
import { ColdService } from './services/ColdService'
import { RestoreRunner } from './services/RestoreRunner'
import { StatsService } from './services/StatsService'
import { DuplicateService } from './services/DuplicateService'
import { WatchService, type WatchAddInput } from './services/WatchService'
import { AIService } from './services/AIService'
import type { RestoreOptions } from '@core/RestoreService'
import type { ScanType, AIExplainInput, AIIdentifyInput, Rule } from '@shared/types'

const require_ = createRequire(__filename)

/** 解析 sql.js WASM 文件的绝对路径（dev 取 node_modules，打包后随 sql.js 一起 unpack）。 */
function locateSqlWasm(file: string): string {
  try {
    return require_.resolve(`sql.js/dist/${file}`)
  } catch {
    return join(__dirname, file)
  }
}

let db: Db | null = null
let scanService: ScanService | null = null
let cleanRunner: CleanRunner | null = null
let backupService: BackupService | null = null
let migrateRunner: MigrateRunner | null = null
let coldService: ColdService | null = null
let restoreRunner: RestoreRunner | null = null
let statsService: StatsService | null = null
let duplicateService: DuplicateService | null = null
let watchService: WatchService | null = null
let aiService: AIService | null = null
let win: BrowserWindow | null = null
/** 用户是否选择「最小化到托盘」（默认 false，关闭即退出，遵守 §17.1）。 */
let minimizeToTray = false
/** 真正退出标志：托盘「退出」或 app.quit() 触发，绕过最小化到托盘。 */
let quitting = false

function showWindow(): void {
  if (!win) {
    createWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win?.show())

  // 最小化到托盘（仅当用户开启）：关闭窗口时隐藏而非退出。默认关闭即退出。
  win.on('close', (e) => {
    if (minimizeToTray && !quitting) {
      e.preventDefault()
      win?.hide()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** 应用「最小化到托盘」设置：开启则建托盘，关闭则销毁。 */
function applyTraySetting(enabled: boolean): void {
  minimizeToTray = enabled
  if (enabled) {
    ensureTray({
      onOpen: () => showWindow(),
      onQuit: () => {
        quitting = true
        app.quit()
      }
    })
    refreshDueBadge()
  } else {
    destroyTray()
  }
}

/** 刷新托盘到期角标（不移动/删除文件，仅读取观察状态）。 */
function refreshDueBadge(): void {
  if (!minimizeToTray || !watchService) return
  try {
    updateTrayTooltip(watchService.dueCount())
  } catch {
    /* 角标刷新失败不影响主流程 */
  }
}

function registerIpc(): void {
  // M0 连通性验证（T0.3）
  ipcMain.handle('ping', () => ({ ok: true, ts: new Date().toISOString() }))

  // 设置读写
  ipcMain.handle('settings:get', (_e, key: string, fallback: unknown) =>
    db?.getSetting(key, fallback)
  )
  ipcMain.handle('settings:set', (_e, key: string, value: unknown) => {
    db?.setSetting(key, value)
    return { ok: true }
  })

  // 扫描（M2）
  ipcMain.handle('scan:start', (e, type: ScanType) => scanService!.run(type, e.sender))
  ipcMain.handle('scan:cancel', () => {
    scanService?.cancel()
    return { ok: true }
  })
  ipcMain.handle('scan:summary', (_e, scanId: number) => scanService!.categorySummary(scanId))
  ipcMain.handle('scan:items', (_e, scanId: number, category?: string) =>
    scanService!.items(scanId, category)
  )

  // 清理（M3）
  ipcMain.handle('clean:preview', (_e, scanId: number) => cleanRunner!.preview(scanId))
  ipcMain.handle('clean:run', (e, opts: CleanRunOptions) => cleanRunner!.run(opts, e.sender))
  ipcMain.handle('clean:cancel', () => {
    cleanRunner?.cancel()
    return { ok: true }
  })
  ipcMain.handle('clean:emptyRecycleBin', () => cleanRunner!.emptyRecycleBin())

  // 备份盘（M4）
  ipcMain.handle('backup:get', () => backupService!.get())
  ipcMain.handle('backup:validate', (_e, path: string) => backupService!.validate(path))
  ipcMain.handle('backup:set', (_e, path: string, coldPeriodDays?: number) =>
    backupService!.set(path, coldPeriodDays)
  )
  ipcMain.handle('backup:isOnline', () => backupService!.isOnline())

  // 迁移与冷藏（M4）
  ipcMain.handle('migrate:preview', (_e, scanId: number) => migrateRunner!.preview(scanId))
  ipcMain.handle('migrate:plan', (_e, scanId: number, paths?: string[]) =>
    migrateRunner!.plan(scanId, paths)
  )
  ipcMain.handle('migrate:run', (e, scanId: number, paths?: string[]) =>
    migrateRunner!.run(scanId, paths, e.sender)
  )
  ipcMain.handle('migrate:cancel', () => {
    migrateRunner?.cancel()
    return { ok: true }
  })
  ipcMain.handle('cold:list', () => coldService!.list())
  ipcMain.handle('cold:delete', (_e, id: string) => coldService!.deletePermanently(id))
  ipcMain.handle('cold:extend', (_e, id: string, periodDays: number) =>
    coldService!.extend(id, periodDays)
  )

  // 恢复（M5）
  ipcMain.handle('restore:precheck', (_e, id: string, targetPath?: string) =>
    restoreRunner!.precheck(id, targetPath)
  )
  ipcMain.handle('restore:run', (_e, id: string, opts?: RestoreOptions) =>
    restoreRunner!.run(id, opts)
  )

  // 首页概览与操作记录（M6）
  ipcMain.handle('overview:get', () => statsService!.overview())
  ipcMain.handle('ops:list', (_e, opType?: string, limit?: number) =>
    statsService!.operations(opType, limit)
  )
  ipcMain.handle('ops:export', async (_e, format: 'json' | 'csv', opType?: string) => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const res = await dialog.showSaveDialog(win ?? undefined!, {
      title: '导出操作记录',
      defaultPath: `operations-${stamp}.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }]
    })
    if (res.canceled || !res.filePath) return { ok: false, canceled: true }
    try {
      await fsp.writeFile(res.filePath, statsService!.buildExport(format, opType), 'utf8')
      return { ok: true, path: res.filePath }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  // 重复文件候选（M8.1）
  ipcMain.handle('dup:groups', (_e, scanId: number, minSize?: number) =>
    duplicateService!.groups(scanId, minSize)
  )

  // 观察列表（M8.2）
  ipcMain.handle('watch:add', (_e, input: WatchAddInput) => watchService!.add(input))
  ipcMain.handle('watch:list', () => watchService!.list())
  ipcMain.handle('watch:check', () => watchService!.check())
  ipcMain.handle('watch:extend', (_e, id: string, periodDays: number) =>
    watchService!.extend(id, periodDays)
  )
  ipcMain.handle('watch:ignore', (_e, id: string) => watchService!.ignore(id))
  ipcMain.handle('watch:remove', (_e, id: string) => watchService!.remove(id))

  // AI 顾问（M8.3）：仅本地、零云端、仅建议
  ipcMain.handle('ai:status', () => aiService!.status())
  ipcMain.handle('ai:explain', (_e, input: AIExplainInput) => aiService!.explain(input))
  ipcMain.handle('ai:summarizeReport', (_e, payload: { op: string; freed_bytes: number; counts: Record<string, number> }) =>
    aiService!.summarizeReport(payload)
  )
  ipcMain.handle('ai:parseRule', (_e, nl: string) => aiService!.parseRule(nl))
  ipcMain.handle('ai:identify', (_e, inputs: AIIdentifyInput[]) => aiService!.identify(inputs))

  // 用户规则（NL 生成，预览确认后落库）
  ipcMain.handle('rules:save', (_e, rule: Rule) => {
    const r = aiService!.saveRule(rule)
    if (r.ok) scanService!.reloadRules()
    return r
  })
  ipcMain.handle('rules:list', () => aiService!.listRules())
  ipcMain.handle('rules:delete', (_e, id: string) => {
    const r = aiService!.deleteRule(id)
    scanService!.reloadRules()
    return r
  })

  // 托盘与关于（M8.5）。托盘默认关闭，开启即建/销毁。
  ipcMain.handle('tray:setEnabled', (_e, enabled: boolean) => {
    db?.setSetting('minimize_to_tray', enabled)
    applyTraySetting(enabled)
    return { ok: true }
  })
  ipcMain.handle('app:version', () => app.getVersion())
  // 仅允许 http/https 外链（如手动前往发布页），不做后台自动更新/联网。
  ipcMain.handle('app:openExternal', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
      return { ok: true }
    }
    return { ok: false, error: '仅允许 http/https 链接' }
  })
}

app.whenReady().then(async () => {
  const dbPath = join(app.getPath('userData'), 'app.db')
  db = await Db.create(dbPath, locateSqlWasm)
  scanService = new ScanService(db, process.resourcesPath)
  cleanRunner = new CleanRunner(db)
  backupService = new BackupService(db)
  migrateRunner = new MigrateRunner(db, backupService)
  coldService = new ColdService(db, backupService)
  restoreRunner = new RestoreRunner(db, backupService)
  statsService = new StatsService(db, backupService)
  duplicateService = new DuplicateService(db)
  watchService = new WatchService(db)
  aiService = new AIService(db)
  registerIpc()
  createWindow()

  // 应用托盘设置（默认 false：关闭即退出，遵守 §17.1）
  applyTraySetting(db.getSetting<boolean>('minimize_to_tray', false))

  // 启动时做一次到期提醒（仅本地通知，非后台监控）。
  void watchService.check().then((items) => {
    const due = items.filter((i) => i.status === 'due').length
    refreshDueBadge()
    if (due > 0) notifyDue(due, () => showWindow())
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showWindow()
  })
})

app.on('before-quit', () => {
  quitting = true
})

app.on('window-all-closed', () => {
  // 轻量化：默认关闭即退出，不常驻后台（PRD §17.1）。
  // 仅当用户开启「最小化到托盘」时，窗口关闭走 hide，不会触发此事件。
  destroyTray()
  db?.close()
  if (process.platform !== 'darwin') app.quit()
})
