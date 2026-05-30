import { randomUUID } from 'crypto'
import { open } from 'node:fs/promises'
import type { Db } from '../infra/Db'
import type {
  AIAdvice, AIExplainInput, AIIdentifyInput, AIIdentifyResult,
  AIRuleDraft, AIStatus, Category, Rule
} from '@shared/types'
import type { AIProvider } from '@core/ai/AIProvider'
import { LocalProvider, type FetchLike } from '@core/ai/LocalProvider'
import {
  buildExplainPrompt, parseAdvice, templateAdvice, buildRulePrompt, parseRule,
  buildIdentifyPrompt, parseIdentify, heuristicDescribe, type IdentifyItem
} from '@core/ai/prompt'
import { sanitizeAdvice, sanitizeRule } from '@core/ai/aiSafety'
import { shouldPeekContent, sanitizeSnippet } from '@core/ai/contentPeek'

/** 供 NL 规则 prompt 的分类提示（仅作模型提示，安全收敛在 aiSafety 完成）。 */
const CATEGORY_HINTS: Category[] = [
  'sys_temp', 'browser_cache', 'dev_pkg_cache', 'dev_build_output',
  'pkg_installer', 'pkg_archive', 'media_video', 'media_image',
  'doc_office', 'doc_pdf', 'uncategorized'
]

const DEFAULTS = { endpoint: 'http://localhost:11434', model: '', timeoutMs: 20_000 }

/**
 * AI 顾问服务（PRD §13）。编排：探活→调用本地模型→schema 校验→安全后处理→降级。
 * 安全边界：仅本地零云端、仅建议、元数据输入；任何失败都降级到模板，绝不阻断主流程。
 */
export class AIService {
  /** fetch 注入便于单测；运行时默认用全局 fetch（Electron/Node18+ 内置）。 */
  constructor(
    private db: Db,
    private fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike
  ) {}

  private config(): { enabled: boolean; endpoint: string; model: string; timeoutMs: number } {
    return {
      enabled: this.db.getSetting<boolean>('ai_enabled', false),
      endpoint: this.db.getSetting<string>('ai_endpoint', DEFAULTS.endpoint),
      model: this.db.getSetting<string>('ai_model', DEFAULTS.model),
      timeoutMs: this.db.getSetting<number>('ai_timeout_ms', DEFAULTS.timeoutMs)
    }
  }

  private provider(): AIProvider {
    const c = this.config()
    return new LocalProvider(
      { endpoint: c.endpoint, model: c.model, timeoutMs: c.timeoutMs },
      this.fetchImpl
    )
  }

  /** 探活与配置回显（设置页「检测」按钮）。 */
  async status(): Promise<AIStatus> {
    const c = this.config()
    const base: AIStatus = {
      enabled: c.enabled, available: false, endpoint: c.endpoint, model: c.model
    }
    // 「检测」是纯连通性测试：即使尚未启用也允许探活，方便用户先确认能连上再启用。
    if (!c.model) return { ...base, error: '未设置模型名（例如 llama3.2:latest）' }
    try {
      base.available = await this.provider().available()
      if (!base.available) base.error = '本地模型未响应（请确认 Ollama 已启动并已拉取模型）'
    } catch (e) {
      base.error = String(e)
    }
    return base
  }

  /** 「为什么」解释：本地模型生成或降级到模板。绝不抛出。 */
  async explain(input: AIExplainInput): Promise<AIAdvice> {
    const c = this.config()
    if (!c.enabled || !c.model) return templateAdvice(input)
    try {
      const provider = this.provider()
      if (!(await provider.available())) return templateAdvice(input)
      const raw = await provider.complete(buildExplainPrompt(input))
      const advice = sanitizeAdvice(parseAdvice(raw), input.risk_level)
      this.log('ai', input.path, 'success', advice.summary)
      return advice
    } catch (e) {
      this.log('ai', input.path, 'failed', String(e))
      return templateAdvice(input)
    }
  }

  /**
   * 报告总结：对一次清理/迁移结果做一句话总结（元数据聚合，不含文件内容）。
   * 失败降级为模板文案。
   */
  async summarizeReport(payload: {
    op: string
    freed_bytes: number
    counts: Record<string, number>
  }): Promise<{ summary: string; ai_generated: boolean }> {
    const c = this.config()
    const template = {
      summary: `本次${payload.op}：释放约 ${payload.freed_bytes} 字节，` +
        Object.entries(payload.counts).map(([k, v]) => `${k} ${v}`).join('，') + '。',
      ai_generated: false
    }
    if (!c.enabled || !c.model) return template
    try {
      const provider = this.provider()
      if (!(await provider.available())) return template
      const prompt = [
        '你是只读顾问，只能基于以下统计用简体中文写一句话总结，不臆测文件内容。',
        '只输出 JSON：{"summary":"..."}',
        JSON.stringify(payload)
      ].join('\n')
      const raw = await provider.complete(prompt)
      const advice = parseAdvice(raw)
      this.log('ai', null, 'success', advice.summary)
      return { summary: advice.summary, ai_generated: true }
    } catch {
      return template
    }
  }

  /**
   * 批量识别文件“大概是什么”。对安全的小文本文件读取开头片段（仅发本机模型、不出网），
   * 其余仅用元数据。未启用/不可用时降级为基于路径的启发式描述。绝不抛出。
   */
  async identify(inputs: AIIdentifyInput[]): Promise<AIIdentifyResult[]> {
    if (!inputs.length) return []
    const c = this.config()
    if (!c.enabled || !c.model) return inputs.map(heuristicDescribe)
    let provider: AIProvider
    try {
      provider = this.provider()
      if (!(await provider.available())) return inputs.map(heuristicDescribe)
    } catch {
      return inputs.map(heuristicDescribe)
    }

    const results: AIIdentifyResult[] = []
    const CHUNK = 10
    for (let off = 0; off < inputs.length; off += CHUNK) {
      const chunk = inputs.slice(off, off + CHUNK)
      const items: IdentifyItem[] = []
      for (const meta of chunk) {
        // 安全闸门按逻辑路径（path）判定；实际读取可指向 read_path（如冷藏项的备份副本）。
        const snippet = shouldPeekContent(meta)
          ? await this.readSnippet(meta.read_path ?? meta.path)
          : null
        items.push({ meta, snippet })
      }
      try {
        const raw = await provider.complete(buildIdentifyPrompt(items))
        const parsed = parseIdentify(raw, items.length)
        chunk.forEach((meta, i) => {
          const r = parsed[i]
          if (r && r.description) {
            results.push({
              path: meta.path,
              description: r.description,
              confidence: r.confidence,
              used_content: !!items[i].snippet,
              ai_generated: true
            })
          } else {
            results.push(heuristicDescribe(meta))
          }
        })
        this.log('ai', null, 'success', `识别 ${chunk.length} 个文件`)
      } catch (e) {
        this.log('ai', null, 'failed', String(e))
        chunk.forEach((meta) => results.push(heuristicDescribe(meta)))
      }
    }
    return results
  }

  /** 读取文件开头少量字节并净化为文本片段；失败返回 null。 */
  private async readSnippet(path: string, bytes = 4096): Promise<string | null> {
    try {
      const fh = await open(path, 'r')
      try {
        const buf = Buffer.alloc(bytes)
        const { bytesRead } = await fh.read(buf, 0, bytes, 0)
        return sanitizeSnippet(buf.subarray(0, bytesRead).toString('utf8'))
      } finally {
        await fh.close()
      }
    } catch {
      return null
    }
  }

  /**
   * 自然语言→规则草案（PRD §13.5）。结果必须进入预览确认，本方法不落库、不启用。
   * 安全收敛由 sanitizeRule 完成（拒绝高风险/禁止目录，危险动作降级）。
   */
  async parseRule(nl: string): Promise<AIRuleDraft> {
    const c = this.config()
    if (!c.enabled || !c.model) {
      return { ok: false, explanation: '', warnings: [], error: 'AI 未启用，无法解析自然语言规则。', ai_generated: false }
    }
    try {
      const provider = this.provider()
      if (!(await provider.available())) {
        return { ok: false, explanation: '', warnings: [], error: '本地模型不可用。', ai_generated: false }
      }
      const raw = await provider.complete(buildRulePrompt(nl, CATEGORY_HINTS))
      const draft = parseRule(raw)
      const safe = sanitizeRule(draft)
      if (!safe.ok || !safe.rule) {
        return { ok: false, explanation: '', warnings: safe.warnings, error: safe.error, ai_generated: true }
      }
      return {
        ok: true,
        rule: safe.rule,
        explanation: safe.rule.explain,
        warnings: safe.warnings,
        ai_generated: true
      }
    } catch (e) {
      return { ok: false, explanation: '', warnings: [], error: String(e), ai_generated: true }
    }
  }

  /**
   * 用户在预览中确认后落库（PRD §13.5）。落库前再次安全收敛，绝不持久化越界规则。
   * source='nl_generated'，扫描时由 ScanService 以最低优先级加载。
   */
  saveRule(rule: Rule): { ok: boolean; id?: string; error?: string } {
    const safe = sanitizeRule(rule)
    if (!safe.ok || !safe.rule) return { ok: false, error: safe.error ?? '规则未通过安全校验' }
    const id = randomUUID()
    this.db.run(
      'INSERT INTO user_rules(id, json, source, enabled, created_at) VALUES(?,?,?,?,?)',
      [id, JSON.stringify(safe.rule), 'nl_generated', 1, new Date().toISOString()]
    )
    this.db.flush()
    return { ok: true, id }
  }

  listRules(): Array<{ id: string; rule: Rule; enabled: boolean; created_at: string }> {
    const rows = this.db.query<{ id: string; json: string; enabled: number; created_at: string }>(
      "SELECT id, json, enabled, created_at FROM user_rules WHERE source='nl_generated' ORDER BY created_at DESC"
    )
    return rows.flatMap((r) => {
      try {
        return [{ id: r.id, rule: JSON.parse(r.json) as Rule, enabled: !!r.enabled, created_at: r.created_at }]
      } catch {
        return []
      }
    })
  }

  deleteRule(id: string): { ok: boolean } {
    this.db.run('DELETE FROM user_rules WHERE id = ?', [id])
    this.db.flush()
    return { ok: true }
  }

  private log(opType: string, path: string | null, status: string, summary: string): void {
    try {
      this.db.logOperation({
        ts: new Date().toISOString(),
        op_type: opType,
        path,
        status,
        ai_summary: summary
      })
    } catch {
      /* 日志失败不影响主流程 */
    }
  }
}
