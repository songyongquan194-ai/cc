import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'path'
import { existsSync, rmSync, mkdtempSync } from 'fs'
import { createRequire } from 'module'
import { Db } from '../../infra/Db'
import { AIService } from '../AIService'
import type { FetchLike } from '@core/ai/LocalProvider'
import type { AIExplainInput } from '@shared/types'

const require_ = createRequire(import.meta.url)
const locate = (f: string): string => require_.resolve(`sql.js/dist/${f}`)

let base: string
afterEach(() => {
  if (base && existsSync(base)) rmSync(base, { recursive: true, force: true })
})

async function mkDb(): Promise<Db> {
  base = mkdtempSync(join(process.cwd(), 'aitmp-'))
  return Db.create(join(base, 'app.db'), locate)
}

const input: AIExplainInput = {
  path: 'C:\\Users\\A\\AppData\\Local\\Temp\\x.tmp',
  ext: '.tmp', size_bytes: 1024, mtime: null, atime: null,
  category: 'sys_temp', risk_level: 'safe', default_action: 'clean',
  rule_explain: '系统临时文件，可安全清理。'
}

/** 构造一个本地模型应答桩。 */
function stubFetch(chatContent: string, tagsOk = true): FetchLike {
  return async (url) => {
    if (url.endsWith('/api/tags')) return { ok: tagsOk, status: 200, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => ({ message: { content: chatContent } }) }
  }
}

describe('AIService (real sql.js + 注入 fetch)', () => {
  it('未启用时 explain 走模板降级，不触网', async () => {
    const db = await mkDb()
    let called = false
    const fetchImpl: FetchLike = async () => { called = true; return { ok: true, status: 200, json: async () => ({}) } }
    const ai = new AIService(db, fetchImpl)
    const a = await ai.explain(input)
    expect(a.ai_generated).toBe(false)
    expect(called).toBe(false)
  })

  it('启用 + 模型可用时返回 AI 结果并写 ai_summary 日志', async () => {
    const db = await mkDb()
    db.setSetting('ai_enabled', true)
    db.setSetting('ai_model', 'qwen2.5')
    const ai = new AIService(db, stubFetch('{"summary":"是临时文件，可清理","basis":["在Temp"]}'))
    const a = await ai.explain(input)
    expect(a.ai_generated).toBe(true)
    expect(a.summary).toContain('临时文件')
    const logs = db.query<{ op_type: string; ai_summary: string }>(
      "SELECT op_type, ai_summary FROM operations WHERE op_type='ai'"
    )
    expect(logs.length).toBe(1)
    expect(logs[0].ai_summary).toContain('临时文件')
  })

  it('模型返回坏内容时降级模板，不抛', async () => {
    const db = await mkDb()
    db.setSetting('ai_enabled', true)
    db.setSetting('ai_model', 'qwen2.5')
    const ai = new AIService(db, stubFetch('这不是JSON'))
    const a = await ai.explain(input)
    expect(a.ai_generated).toBe(false)
  })

  it('高风险项即使模型建议删除也被收敛', async () => {
    const db = await mkDb()
    db.setSetting('ai_enabled', true)
    db.setSetting('ai_model', 'qwen2.5')
    const ai = new AIService(db, stubFetch('{"summary":"系统文件","recommendation":"建议直接删除释放空间"}'))
    const a = await ai.explain({ ...input, risk_level: 'high', default_action: 'none' })
    expect(a.recommendation).not.toContain('删除')
    expect(a.risks.join('')).toContain('高风险')
  })

  it('status：启用但模型不可用返回 available=false + error', async () => {
    const db = await mkDb()
    db.setSetting('ai_enabled', true)
    db.setSetting('ai_model', 'qwen2.5')
    const ai = new AIService(db, stubFetch('{}', false))
    const s = await ai.status()
    expect(s.enabled).toBe(true)
    expect(s.available).toBe(false)
    expect(s.error).toBeTruthy()
  })

  it('parseRule：解析并安全收敛为可预览草案', async () => {
    const db = await mkDb()
    db.setSetting('ai_enabled', true)
    db.setSetting('ai_model', 'qwen2.5')
    const content = '{"name":"清理下载安装包","category":"pkg_installer","match":{"path_globs":["%USERPROFILE%\\\\Downloads\\\\*.exe"]},"risk_level":"low","default_action":"clean","explain":"清理下载目录中的安装包"}'
    const ai = new AIService(db, stubFetch(content))
    const draft = await ai.parseRule('把下载里的安装包清理掉')
    expect(draft.ok).toBe(true)
    expect(draft.rule?.priority_class).toBe(5)
    expect(draft.rule?.delete_policy).toBe('none')
  })

  it('parseRule：模型给出禁止目录规则时被拒绝', async () => {
    const db = await mkDb()
    db.setSetting('ai_enabled', true)
    db.setSetting('ai_model', 'qwen2.5')
    const content = '{"name":"x","category":"sys_temp","match":{"path_globs":["C:\\\\Windows\\\\System32\\\\*"]},"risk_level":"low","default_action":"clean","explain":"y"}'
    const ai = new AIService(db, stubFetch(content))
    const draft = await ai.parseRule('清理 system32')
    expect(draft.ok).toBe(false)
    expect(draft.error).toContain('禁止目录')
  })
})
