import { describe, it, expect } from 'vitest'
import { sanitizeAdvice, sanitizeRule } from '../aiSafety'
import type { AIAdvice, Rule } from '@shared/types'

const baseAdvice: AIAdvice = {
  summary: 's',
  basis: [],
  risks: [],
  recommendation: '建议删除该文件以释放空间',
  uncertainty: '',
  ai_generated: true
}

const baseRule: Rule = {
  name: 'r',
  category: 'pkg_installer',
  match: { path_globs: ['%USERPROFILE%\\Downloads\\*.exe'] },
  risk_level: 'low',
  default_action: 'clean',
  delete_policy: 'none',
  requires_app_closed: false,
  explain: 'x',
  priority_class: 5
}

describe('sanitizeAdvice', () => {
  it('安全项原样返回', () => {
    expect(sanitizeAdvice(baseAdvice, 'safe')).toEqual(baseAdvice)
  })
  it('高风险项剔除删除措辞并加风险提示', () => {
    const out = sanitizeAdvice(baseAdvice, 'high')
    expect(out.recommendation).not.toContain('删除')
    expect(out.risks.join('')).toContain('高风险')
  })
  it('禁止项同样被收敛', () => {
    const out = sanitizeAdvice(baseAdvice, 'forbidden')
    expect(out.recommendation).toContain('默认不处理')
  })
})

describe('sanitizeRule', () => {
  it('合法低风险规则通过并强制最低优先级', () => {
    const res = sanitizeRule(baseRule)
    expect(res.ok).toBe(true)
    expect(res.rule?.priority_class).toBe(5)
    expect(res.rule?.delete_policy).toBe('none')
  })
  it('拒绝 high/forbidden 风险规则', () => {
    expect(sanitizeRule({ ...baseRule, risk_level: 'high' }).ok).toBe(false)
    expect(sanitizeRule({ ...baseRule, risk_level: 'forbidden' }).ok).toBe(false)
  })
  it('命中系统禁止目录则拒绝', () => {
    const res = sanitizeRule({
      ...baseRule,
      match: { path_globs: ['C:\\Windows\\System32\\*'] }
    })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('禁止目录')
  })
  it('中等风险的 clean 降级为 migrate', () => {
    const res = sanitizeRule({ ...baseRule, risk_level: 'medium', default_action: 'clean' })
    expect(res.ok).toBe(true)
    expect(res.rule?.default_action).toBe('migrate')
    expect(res.warnings.length).toBeGreaterThan(0)
  })
  it('未知动作降级为 migrate', () => {
    const res = sanitizeRule({ ...baseRule, default_action: 'none' })
    expect(res.rule?.default_action).toBe('migrate')
  })
})
