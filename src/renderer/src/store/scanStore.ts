import { create } from 'zustand'
import type { ScanProgress, ScanType } from '@shared/types'

export interface SummaryRow {
  category: string
  risk_level: string
  count: number
  bytes: number
}

export interface ScanResult {
  scanId?: number
  total_files: number
  safe_bytes: number
  migratable_bytes: number
  highrisk_bytes: number
  elapsed_ms: number
  cancelled: boolean
  dir_error_count: number
}

interface ScanState {
  scanning: boolean
  progress: ScanProgress | null
  scanId: number | null
  summary: SummaryRow[]
  result: ScanResult | null
  /** 启动扫描。会话状态存于 store，切换界面不丢、主进程扫描照常进行。 */
  startScan: (type: ScanType) => Promise<void>
  /** 唯一的显式中断入口（对应「取消」按钮）。 */
  cancel: () => void
}

export const useScanStore = create<ScanState>((set, get) => ({
  scanning: false,
  progress: null,
  scanId: null,
  summary: [],
  result: null,
  startScan: async (type) => {
    if (get().scanning) return
    set({ scanning: true, progress: null, summary: [], result: null, scanId: null })
    try {
      const r = (await window.api.scan.start(type)) as ScanResult
      set({ scanId: r.scanId ?? null, result: r })
      const s = (await window.api.scan.summary(r.scanId!)) as SummaryRow[]
      set({ summary: s })
    } finally {
      set({ scanning: false })
    }
  },
  cancel: () => {
    void window.api.scan.cancel()
  }
}))

// 进度订阅常驻（模块级，仅注册一次）：即使 ScanView 因切换界面而卸载，
// 主进程推送的扫描进度仍会写入 store，回到扫描页即可看到最新进度。
window.api.scan.onProgress((p) => useScanStore.setState({ progress: p }))
