// 结构化 prompt 构造 + 模型输出解析 + 模板降级（PRD §13.3/§13.5）。
// 纯函数，无副作用、无 I/O，可单测。所有输入仅为元数据，绝不含文件内容。

import type {
  AIAdvice, AIExplainInput, AIIdentifyInput, AIIdentifyResult,
  Category, DefaultAction, RiskLevel, Rule
} from '@shared/types'
import { RISK_NEVER_AUTO } from './aiSafety'

/** 全局系统约束：写进每个 prompt，约束模型只做顾问、不越界。 */
export const SYSTEM_CONSTRAINTS = [
  '你是 Windows C 盘清理工具内置的「只读顾问」。',
  '你只能解释和建议，绝不能决定删除/迁移/恢复，也不能调用任何工具或操作文件。',
  '你只能看到文件的元数据（路径、扩展名、大小、时间、分类、风险等级），看不到文件内容。',
  '高风险（high）与禁止（forbidden）项一律视为不可自动处理，你不得建议自动删除它们。',
  '必须坦诚不确定性：依据不足时明确说“无法确定”，不要臆测文件内容。',
  '只输出 JSON，不要任何解释性前后缀、不要使用 Markdown 代码块。'
].join('\n')

function metaBlock(input: AIExplainInput): string {
  return [
    `路径: ${input.path}`,
    `扩展名: ${input.ext || '(无)'}`,
    `大小字节: ${input.size_bytes}`,
    `修改时间: ${input.mtime ?? '未知'}`,
    `访问时间: ${input.atime ?? '未知'}`,
    `规则分类: ${input.category}`,
    `风险等级: ${input.risk_level}`,
    `默认动作: ${input.default_action}`,
    `规则解释: ${input.rule_explain}`
  ].join('\n')
}

/** 构造「为什么」解释 prompt，要求严格 JSON 输出。 */
export function buildExplainPrompt(input: AIExplainInput): string {
  return [
    SYSTEM_CONSTRAINTS,
    '',
    '基于以下文件元数据，用简体中文给出顾问意见：',
    metaBlock(input),
    '',
    '严格按此 JSON schema 输出（字段齐全，字符串用中文）：',
    '{',
    '  "summary": "一句话说明这是什么、能否处理",',
    '  "basis": ["判断依据1", "依据2"],',
    '  "risks": ["处理后可能影响1"],',
    '  "recommendation": "建议动作的文字描述（不触发任何操作）",',
    '  "uncertainty": "你不确定的地方"',
    '}'
  ].join('\n')
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter((s) => s.trim().length > 0)
  if (typeof v === 'string' && v.trim()) return [v.trim()]
  return []
}

/** 从模型原始输出中抽取首个 JSON 对象（容忍代码块/多余文字）。 */
export function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) throw new Error('未找到 JSON 对象')
  return JSON.parse(body.slice(start, end + 1))
}

/** 解析模型输出为结构化 AIAdvice。无法解析时抛出，调用方降级到模板。 */
export function parseAdvice(raw: string): AIAdvice {
  const obj = extractJson(raw) as Record<string, unknown>
  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : ''
  if (!summary) throw new Error('缺少 summary 字段')
  return {
    summary,
    basis: asStringArray(obj.basis),
    risks: asStringArray(obj.risks),
    recommendation: typeof obj.recommendation === 'string' ? obj.recommendation.trim() : '',
    uncertainty: typeof obj.uncertainty === 'string' ? obj.uncertainty.trim() : '',
    ai_generated: true
  }
}

const RISK_TEXT: Record<RiskLevel, string> = {
  safe: '可安全清理',
  low: '低风险',
  medium: '中等风险，建议迁移冷藏而非删除',
  high: '高风险，默认不处理',
  forbidden: '系统关键项，禁止处理'
}

const ACTION_TEXT: Record<DefaultAction, string> = {
  none: '默认不处理（仅展示）',
  clean: '可加入安全清理',
  migrate: '建议迁移到备份盘冷藏，而非删除'
}

/**
 * 模板降级：本地模型不可用时，用规则信息拼出结构化解释。
 * 与 AI 输出同构，保证 UI 一致；ai_generated=false。
 */
export function templateAdvice(input: AIExplainInput): AIAdvice {
  const risks = RISK_NEVER_AUTO.has(input.risk_level)
    ? ['该项为高风险/禁止项，本工具默认不处理，请勿手动删除系统或程序关键文件。']
    : input.default_action === 'migrate'
      ? ['迁移后原位置文件将移动到备份盘，可随时恢复。']
      : ['清理后该文件将进入回收站或被移除，通常可由应用重新生成。']
  return {
    summary: `${input.rule_explain}（${RISK_TEXT[input.risk_level]}）`,
    basis: [
      `命中规则分类：${input.category}`,
      `风险等级：${RISK_TEXT[input.risk_level]}`
    ],
    risks,
    recommendation: ACTION_TEXT[input.default_action],
    uncertainty: '本说明由内置规则生成（本地模型未启用），未结合文件实际内容。',
    ai_generated: false
  }
}

// ── 文件识别（批量）：判断“这大概是什么文件”。可附带受控的本机文本片段。 ──

/** 文件识别的系统约束（与 explain 不同：此处允许出现少量本机文本片段）。 */
export const IDENTIFY_CONSTRAINTS = [
  '你是只在用户本机运行的文件识别助手。',
  '根据每个文件的元数据（路径、名称、扩展名、大小、时间、分类）判断它“大概是什么文件”。',
  '部分文件附带了开头的少量文本片段，仅供你判断用途，不要原样复述其中任何敏感信息。',
  '用简体中文，每个文件给一句话描述（不超过 40 字），并给出置信度 high/medium/low。',
  '依据不足时给 low，并说“可能是…/无法确定”，绝不编造。',
  '只输出 JSON 数组，不要任何额外文字、不要使用 Markdown 代码块。'
].join('\n')

export interface IdentifyItem {
  meta: AIIdentifyInput
  snippet?: string | null
}

/** 构造批量识别 prompt。i 为序号，便于把结果对回原文件。 */
export function buildIdentifyPrompt(items: IdentifyItem[]): string {
  const lines = items.map((it, i) => {
    const m = it.meta
    const base = `[${i}] 路径:${m.path} 扩展名:${m.ext || '(无)'} 大小字节:${m.size_bytes} 分类:${m.category} 风险:${m.risk_level}`
    return it.snippet ? `${base}\n内容片段:"""${it.snippet}"""` : base
  })
  return [
    IDENTIFY_CONSTRAINTS,
    '',
    `共 ${items.length} 个文件，必须为每个文件都返回一项，results 数组长度必须等于 ${items.length}：`,
    lines.join('\n'),
    '',
    // 用对象包数组：Ollama 的 format:json 下对象比顶层数组可靠得多。i 与上面序号一一对应。
    '只输出 JSON 对象：{"results":[{"i":0,"description":"一句话说明这大概是什么","confidence":"high|medium|low"}]}'
  ].join('\n')
}

/** 从模型输出中抽取首个 JSON 数组（容忍代码块/多余文字）。 */
export function extractJsonArray(raw: string): unknown[] {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : raw
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) throw new Error('未找到 JSON 数组')
  const parsed = JSON.parse(body.slice(start, end + 1))
  if (!Array.isArray(parsed)) throw new Error('不是 JSON 数组')
  return parsed
}

/** 解析识别结果为按序号对齐的数组。无法解析时抛出，调用方降级。 */
export function parseIdentify(
  raw: string,
  count: number
): { description: string; confidence: 'high' | 'medium' | 'low' }[] {
  const arr = extractJsonArray(raw)
  const out = Array.from({ length: count }, () => ({
    description: '',
    confidence: 'low' as 'high' | 'medium' | 'low'
  }))
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const i = typeof o.i === 'number' ? o.i : -1
    if (i < 0 || i >= count) continue
    const desc = typeof o.description === 'string' ? o.description.trim() : ''
    const conf = o.confidence === 'high' || o.confidence === 'medium' ? o.confidence : 'low'
    if (desc) out[i] = { description: desc, confidence: conf }
  }
  return out
}

const HEURISTICS: [RegExp, string][] = [
  [/\\(temp|tmp)\\|\.tmp$|\.temp$/i, '临时文件，通常可重新生成'],
  [/cache/i, '缓存文件，可重新生成'],
  [/\\logs?\\|\.log$/i, '日志文件，记录程序运行信息'],
  [/crashdump|minidump|\.dmp$/i, '崩溃转储文件，用于事后诊断'],
  [/node_modules/i, 'Node.js 项目依赖文件'],
  [/\.(iso|img|vhdx?|vmdk)$/i, '磁盘/镜像文件，体积较大'],
  [/\.(mp4|mkv|mov|avi|wmv|flv|webm)$/i, '视频文件'],
  [/\.(mp3|wav|flac|aac|m4a)$/i, '音频文件'],
  [/\.(jpg|jpeg|png|gif|bmp|webp|psd|tiff)$/i, '图片文件'],
  [/\.(zip|rar|7z|tar|gz|bz2|xz)$/i, '压缩包'],
  [/\.(exe|msi)$/i, '可执行程序/安装包'],
  [/\.(dll|sys|so|pyd|node)$/i, '程序运行库，删除可能导致软件报错'],
  [/\.(docx?|xlsx?|pptx?|pdf)$/i, 'Office/PDF 文档'],
  [/\.(txt|md|json|xml|yaml|yml|ini|cfg|conf|csv)$/i, '文本/配置文件']
]

/** 降级启发式：本地模型不可用时，仅凭路径/扩展名给出粗略描述。 */
export function heuristicDescribe(input: AIIdentifyInput): AIIdentifyResult {
  const hit = HEURISTICS.find(([re]) => re.test(input.path))
  return {
    path: input.path,
    description: hit ? hit[1] : `${input.category} 类文件（未启用本地模型，仅按路径粗判）`,
    confidence: 'low',
    used_content: false,
    ai_generated: false
  }
}

// ── 自然语言规则（PRD §13.5）。生成的规则必须进入预览确认。 ──

/** 构造 NL→规则 的 prompt。约束模型只能生成 clean/migrate/none，且不得碰 forbidden。 */
export function buildRulePrompt(nl: string, categories: readonly string[]): string {
  return [
    SYSTEM_CONSTRAINTS,
    '',
    '把用户的自然语言整理需求翻译成一条结构化清理规则草案。',
    `用户需求：${nl}`,
    '',
    '约束：',
    '- risk_level 只能是 safe/low/medium，绝不能生成 high 或 forbidden；',
    '- default_action 只能是 clean 或 migrate；危险操作一律降级为 migrate；',
    '- match.path_globs 用 Windows 风格通配（可用 %USERPROFILE% 等环境变量）；',
    `- category 从此列表中选最贴近的：${categories.join(', ')}`,
    '',
    '严格按此 JSON 输出：',
    '{',
    '  "name": "规则简短名称",',
    '  "category": "上面列表中的一个",',
    '  "match": { "path_globs": ["..."], "ext_in": ["可选"], "min_size_bytes": 0, "min_age_days": 0 },',
    '  "risk_level": "safe|low|medium",',
    '  "default_action": "clean|migrate",',
    '  "explain": "向用户解释这条规则做什么"',
    '}'
  ].join('\n')
}

/** 解析模型输出为 Rule 草案（未做安全收敛，交由 aiSafety 处理）。 */
export function parseRule(raw: string): Rule {
  const obj = extractJson(raw) as Record<string, unknown>
  const match = (obj.match ?? {}) as Record<string, unknown>
  const globs = asStringArray(match.path_globs)
  if (globs.length === 0) throw new Error('规则缺少 path_globs')
  const rule: Rule = {
    name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : 'AI 生成规则',
    category: (typeof obj.category === 'string' ? obj.category : 'uncategorized') as Category,
    match: {
      path_globs: globs,
      ext_in: asStringArray(match.ext_in),
      min_size_bytes: typeof match.min_size_bytes === 'number' ? match.min_size_bytes : undefined,
      min_age_days: typeof match.min_age_days === 'number' ? match.min_age_days : undefined
    },
    risk_level: (typeof obj.risk_level === 'string' ? obj.risk_level : 'low') as RiskLevel,
    default_action: (typeof obj.default_action === 'string' ? obj.default_action : 'none') as DefaultAction,
    delete_policy: 'none',
    requires_app_closed: false,
    explain: typeof obj.explain === 'string' ? obj.explain.trim() : 'AI 生成的清理规则',
    priority_class: 5
  }
  if (rule.match.ext_in && rule.match.ext_in.length === 0) delete rule.match.ext_in
  return rule
}
