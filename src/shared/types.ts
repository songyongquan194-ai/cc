// 主进程/渲染进程共享类型。对应 TECH_DESIGN.md §3, §4。

export type RiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'forbidden'

export type DefaultAction = 'none' | 'clean' | 'migrate'

export type DeletePolicy = 'delete_children_only' | 'delete_self' | 'none'

export type ScanType = 'quick' | 'deep'

export type OpType = 'scan' | 'clean' | 'migrate' | 'restore' | 'delete_cold' | 'ai'

export type OpStatus = 'success' | 'failed' | 'skipped'

export type ConfirmLevel = 'none' | 'normal' | 'double' | 'strong'

// 分类枚举 key，对应 TECH_DESIGN.md §3.1
export type Category =
  | 'sys_temp' | 'sys_update_cache' | 'sys_thumbnail' | 'sys_crashdump' | 'sys_recyclebin'
  | 'browser_cache' | 'browser_gpu' | 'browser_sw' | 'browser_download_cache' | 'browser_profile'
  | 'chat_image' | 'chat_video' | 'chat_file' | 'chat_log' | 'chat_offline' | 'chat_db'
  | 'dev_pkg_cache' | 'dev_pip_cache' | 'dev_jvm_cache' | 'dev_cargo_cache' | 'dev_node_modules' | 'dev_build_output'
  | 'design_media_cache' | 'design_ps_temp' | 'design_proxy' | 'design_render_cache'
  | 'game_update_cache' | 'game_installer_cache' | 'game_shader' | 'game_log' | 'game_save'
  | 'vm_docker_image' | 'vm_docker_volume' | 'vm_wsl' | 'vm_hyperv_vmware_vbox' | 'vm_snapshot'
  | 'pkg_installer' | 'pkg_archive' | 'pkg_driver'
  | 'media_video' | 'media_audio' | 'media_image' | 'media_screenrec' | 'media_export'
  | 'doc_office' | 'doc_pdf' | 'doc_source' | 'doc_design_src' | 'doc_data'
  | 'dup_exact' | 'dup_suspect' | 'dup_samename'
  | 'uncategorized'

// 规则匹配条件
export interface RuleMatch {
  path_globs: string[]
  ext_in?: string[]
  min_size_bytes?: number
  min_age_days?: number
}

// 规则定义，对应 TECH_DESIGN.md §4.1
export interface Rule {
  name: string
  category: Category
  match: RuleMatch
  risk_level: RiskLevel
  default_action: DefaultAction
  delete_policy: DeletePolicy
  requires_app_closed: boolean
  explain: string
  /** 0 禁止目录 / 1 用户排除 / 2 高风险保护 / 3 应用专用 / 4 通用类型 / 5 AI */
  priority_class: number
}

// 分类结果
export interface Classification {
  category: Category
  risk_level: RiskLevel
  default_action: DefaultAction
  matched_rule: string | null
  explain: string
  delete_policy: DeletePolicy
}

// 文件元数据（扫描期间收集，绝不含内容）
export interface FileMeta {
  path: string
  size_bytes: number
  mtime: string | null
  atime: string | null
  ext: string
  is_dir: boolean
  is_symlink: boolean
}

// 扫描命中项
export interface ScanItem extends Classification {
  path: string
  size_bytes: number
  mtime: string | null
  atime: string | null
  ext: string
}

// 冷藏项（cold_items 表 / manifest.json 双写，对应 TECH_DESIGN.md §3.2）
export type ColdState = 'active' | 'restored' | 'deleted' | 'missing'

export interface ColdItem {
  id: string
  original_path: string
  cold_path: string
  size_bytes: number
  category: string | null
  risk_level: string | null
  mtime: string | null
  migrated_at: string
  reason: string | null
  explain: string | null
  checksum: string | null
  cold_period_days: number | null
  expires_at: string | null
  state: ColdState
  restorable: boolean
}

// 观察列表项（watch_items 表，PRD §12）。绝不移动/删除文件，仅记录元数据 + 提醒时间。
export type WatchStatus = 'watching' | 'due' | 'recent' | 'missing' | 'ignored'

export interface WatchItem {
  id: string
  path: string
  size_bytes: number | null
  category: string | null
  reason: string | null
  added_at: string
  period_days: number
  remind_at: string
  last_seen_mtime: string | null
  status: WatchStatus
}

// ── AI 顾问模块（PRD §13）。仅本地、零云端、仅建议、元数据输入。 ──

/** 单个文件/分类的元数据输入（绝不含文件内容）。 */
export interface AIExplainInput {
  path: string
  ext: string
  size_bytes: number
  mtime: string | null
  atime: string | null
  category: string
  risk_level: RiskLevel
  default_action: DefaultAction
  /** 规则给出的模板解释，作为 AI 的事实依据。 */
  rule_explain: string
}

/** AI 的结构化建议输出（PRD §13.3）。advisory-only，绝不改变风险或动作。 */
export interface AIAdvice {
  /** 一句话结论（这是什么/能否处理）。 */
  summary: string
  /** 判断依据（基于元数据与规则）。 */
  basis: string[]
  /** 风险提示（处理后可能的影响）。 */
  risks: string[]
  /** 建议动作描述（仅文字，不触发任何操作）。 */
  recommendation: string
  /** 不确定性说明（AI 必须坦诚不确定之处）。 */
  uncertainty: string
  /** 是否由本地模型生成；false 表示降级到模板。 */
  ai_generated: boolean
}

/** AI 文件识别输入（批量）。服务端按安全策略决定是否附带受控的小段文本预览。 */
export interface AIIdentifyInput {
  path: string
  ext: string
  size_bytes: number
  mtime: string | null
  category: string
  risk_level: RiskLevel
  /** 可选：实际读取内容的位置（冷藏项原文件已迁走，从备份盘 cold_path 读）。默认用 path。 */
  read_path?: string
}

/** AI 文件识别结果：用一句话说明这大概是什么文件。 */
export interface AIIdentifyResult {
  path: string
  description: string
  confidence: 'high' | 'medium' | 'low'
  /** 是否读取了文件内容片段判断（仅发本机模型、不出网）。 */
  used_content: boolean
  /** true=本地模型生成；false=降级到基于路径的启发式描述。 */
  ai_generated: boolean
}

/** AI 服务可用性探活结果。 */
export interface AIStatus {
  enabled: boolean
  available: boolean
  endpoint: string
  model: string
  error?: string
}

/** 自然语言规则解析结果（进入预览确认，PRD §13.5）。 */
export interface AIRuleDraft {
  ok: boolean
  rule?: Rule
  /** 给用户的人类可读说明。 */
  explanation: string
  /** 安全后处理给出的告警（如越界已被收敛）。 */
  warnings: string[]
  error?: string
  ai_generated: boolean
}

// 扫描进度（流式 IPC，对应 PRD §7.3）
export interface ScanProgress {
  current_dir: string
  files_scanned: number
  safe_bytes: number
  migratable_bytes: number
  highrisk_bytes: number
  elapsed_ms: number
  done: boolean
}
