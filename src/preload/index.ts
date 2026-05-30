import { contextBridge, ipcRenderer } from 'electron'
import type {
  ScanType, ScanProgress, ScanItem, ColdItem, WatchItem,
  AIExplainInput, AIAdvice, AIStatus, AIRuleDraft, AIIdentifyInput, AIIdentifyResult, Rule
} from '@shared/types'

interface BackupInfo {
  path: string
  cold_root: string
  volume_serial: string | null
  cold_period_days: number
}
interface MigratePlanResult {
  allowed: boolean
  error_code?: string
  c_freed_bytes: number
  backup_used_bytes: number
  backup_free_after: number
  system_free_after: number
  backup_threshold: number
  warnings: string[]
  backup_set: boolean
  item_count: number
}
interface MigrateReport {
  freed_bytes: number
  backup_used_bytes: number
  migrated: number
  source_kept: number
  skipped: number
  failed: number
  details: unknown[]
}

interface CleanLogEntry {
  path: string
  size_bytes: number
  category: string
  risk_level: string
  status: 'success' | 'skipped' | 'failed'
  error_code?: string
  error_detail?: string
}
interface CleanReport {
  freed_bytes: number
  cleaned: number
  skipped: number
  failed: number
  details: CleanLogEntry[]
}
interface CleanProgress {
  processed: number
  total: number
  freed_bytes: number
  cleaned: number
  skipped: number
  failed: number
}

interface OperationRow {
  id: number
  ts: string
  op_type: string
  path: string | null
  dest_path: string | null
  size_bytes: number | null
  category: string | null
  risk_level: string | null
  action: string | null
  status: string
  error_code: string | null
  error_detail: string | null
  user_confirm: string | null
  ai_summary: string | null
  batch_id: string | null
}
interface ScanSummaryRow {
  id: number
  type: string
  finished_at: string | null
  total_files: number
  safe_bytes: number
  migratable_bytes: number
  highrisk_bytes: number
}
interface OverviewData {
  system: { free: number; total: number }
  scan: ScanSummaryRow | null
  cold: { count: number; bytes: number }
  backup: { set: boolean; online: boolean; path: string | null; cold_period_days: number }
  recent: OperationRow[]
}

interface DupFile {
  path: string
  size_bytes: number
  mtime: string | null
  atime: string | null
  category: string | null
}
interface DupGroup {
  key: string
  size_bytes: number
  count: number
  files: DupFile[]
  suggested_keep: string
  reason: string
}
interface DuplicateResult {
  groups: DupGroup[]
  group_count: number
  total_reclaimable: number
}

// 白名单 IPC，对应 TECH_DESIGN.md §2。渲染层只能通过 window.api 访问。
const api = {
  ping: () => ipcRenderer.invoke('ping'),
  settings: {
    get: <T>(key: string, fallback: T): Promise<T> =>
      ipcRenderer.invoke('settings:get', key, fallback),
    set: (key: string, value: unknown): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('settings:set', key, value)
  },
  scan: {
    start: (type: ScanType) => ipcRenderer.invoke('scan:start', type),
    cancel: () => ipcRenderer.invoke('scan:cancel'),
    summary: (scanId: number) => ipcRenderer.invoke('scan:summary', scanId),
    items: (scanId: number, category?: string): Promise<ScanItem[]> =>
      ipcRenderer.invoke('scan:items', scanId, category),
    onProgress: (cb: (p: ScanProgress) => void) => {
      const listener = (_e: unknown, p: ScanProgress): void => cb(p)
      ipcRenderer.on('scan:progress', listener)
      return () => ipcRenderer.removeListener('scan:progress', listener)
    }
  },
  clean: {
    preview: (scanId: number): Promise<ScanItem[]> =>
      ipcRenderer.invoke('clean:preview', scanId),
    run: (opts: { scanId: number; paths?: string[] }): Promise<CleanReport> =>
      ipcRenderer.invoke('clean:run', opts),
    cancel: () => ipcRenderer.invoke('clean:cancel'),
    emptyRecycleBin: (): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('clean:emptyRecycleBin'),
    onProgress: (cb: (p: CleanProgress) => void) => {
      const listener = (_e: unknown, p: CleanProgress): void => cb(p)
      ipcRenderer.on('clean:progress', listener)
      return () => ipcRenderer.removeListener('clean:progress', listener)
    }
  },
  backup: {
    get: (): Promise<BackupInfo | null> => ipcRenderer.invoke('backup:get'),
    validate: (path: string): Promise<{ ok: boolean; error?: string; volume_serial?: string | null }> =>
      ipcRenderer.invoke('backup:validate', path),
    set: (path: string, coldPeriodDays?: number): Promise<{ ok: boolean; error?: string; info?: BackupInfo }> =>
      ipcRenderer.invoke('backup:set', path, coldPeriodDays),
    isOnline: (): Promise<boolean> => ipcRenderer.invoke('backup:isOnline')
  },
  migrate: {
    preview: (scanId: number): Promise<ScanItem[]> => ipcRenderer.invoke('migrate:preview', scanId),
    plan: (scanId: number, paths?: string[]): Promise<MigratePlanResult> =>
      ipcRenderer.invoke('migrate:plan', scanId, paths),
    run: (scanId: number, paths?: string[]): Promise<MigrateReport> =>
      ipcRenderer.invoke('migrate:run', scanId, paths),
    cancel: () => ipcRenderer.invoke('migrate:cancel')
  },
  cold: {
    list: (): Promise<ColdItem[]> => ipcRenderer.invoke('cold:list'),
    delete: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('cold:delete', id),
    extend: (id: string, periodDays: number): Promise<{ ok: boolean; error?: string; expires_at?: string | null }> =>
      ipcRenderer.invoke('cold:extend', id, periodDays)
  },
  restore: {
    precheck: (
      id: string,
      targetPath?: string
    ): Promise<{ found: boolean; ok: boolean; issues: string[]; target_path: string }> =>
      ipcRenderer.invoke('restore:precheck', id, targetPath),
    run: (
      id: string,
      opts?: {
        targetPath?: string
        createParent?: boolean
        onConflict?: 'keep_both' | 'overwrite' | 'cancel'
        removeCold?: boolean
      }
    ): Promise<{
      found: boolean
      status: 'done' | 'failed' | 'cancelled'
      error_code?: string
      error_detail?: string
      restored_path?: string
      cold_kept: boolean
    }> => ipcRenderer.invoke('restore:run', id, opts)
  },
  overview: {
    get: (): Promise<OverviewData> => ipcRenderer.invoke('overview:get')
  },
  ops: {
    list: (opType?: string, limit?: number): Promise<OperationRow[]> =>
      ipcRenderer.invoke('ops:list', opType, limit),
    export: (
      format: 'json' | 'csv',
      opType?: string
    ): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> =>
      ipcRenderer.invoke('ops:export', format, opType)
  },
  dup: {
    groups: (scanId: number, minSize?: number): Promise<DuplicateResult> =>
      ipcRenderer.invoke('dup:groups', scanId, minSize)
  },
  watch: {
    add: (input: {
      path: string
      size_bytes?: number | null
      category?: string | null
      reason?: string | null
      periodDays?: number
    }): Promise<{ ok: boolean; id: string }> => ipcRenderer.invoke('watch:add', input),
    list: (): Promise<WatchItem[]> => ipcRenderer.invoke('watch:list'),
    check: (): Promise<WatchItem[]> => ipcRenderer.invoke('watch:check'),
    extend: (id: string, periodDays: number): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('watch:extend', id, periodDays),
    ignore: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('watch:ignore', id),
    remove: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('watch:remove', id)
  },
  ai: {
    status: (): Promise<AIStatus> => ipcRenderer.invoke('ai:status'),
    explain: (input: AIExplainInput): Promise<AIAdvice> => ipcRenderer.invoke('ai:explain', input),
    summarizeReport: (payload: {
      op: string
      freed_bytes: number
      counts: Record<string, number>
    }): Promise<{ summary: string; ai_generated: boolean }> =>
      ipcRenderer.invoke('ai:summarizeReport', payload),
    parseRule: (nl: string): Promise<AIRuleDraft> => ipcRenderer.invoke('ai:parseRule', nl),
    identify: (inputs: AIIdentifyInput[]): Promise<AIIdentifyResult[]> =>
      ipcRenderer.invoke('ai:identify', inputs)
  },
  rules: {
    save: (rule: Rule): Promise<{ ok: boolean; id?: string; error?: string }> =>
      ipcRenderer.invoke('rules:save', rule),
    list: (): Promise<Array<{ id: string; rule: Rule; enabled: boolean; created_at: string }>> =>
      ipcRenderer.invoke('rules:list'),
    delete: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('rules:delete', id)
  },
  app: {
    version: (): Promise<string> => ipcRenderer.invoke('app:version'),
    setTray: (enabled: boolean): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('tray:setEnabled', enabled),
    openExternal: (url: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('app:openExternal', url)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
