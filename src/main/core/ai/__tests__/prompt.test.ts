import { describe, it, expect } from 'vitest'
import {
  buildExplainPrompt, parseAdvice, extractJson, templateAdvice, buildRulePrompt, parseRule
} from '../prompt'
import type { AIExplainInput } from '@shared/types'

const input: AIExplainInput = {
  path: 'C:\\Users\\Alex\\AppData\\Local\\Temp\\x.tmp',
  ext: '.tmp',
  size_bytes: 1024,
  mtime: '2025-01-01T00:00:00.000Z',
  atime: null,
  category: 'sys_temp',
  risk_level: 'safe',
  default_action: 'clean',
  rule_explain: '系统临时文件，可安全清理。'
}

describe('prompt 构造', () => {
  it('explain prompt 含约束、元数据，但绝不含文件内容字样', () => {
    const p = buildExplainPrompt(input)
    expect(p).toContain('只读顾问')
    expect(p).toContain('看不到文件内容')
    expect(p).toContain(input.path)
    expect(p).toContain('sys_temp')
  })

  it('rule prompt 禁止生成 high/forbidden 与危险动作', () => {
    const p = buildRulePrompt('把下载里超过30天的安装包删掉', ['pkg_installer', 'uncategorized'])
    expect(p).toContain('绝不能生成 high 或 forbidden')
    expect(p).toContain('clean 或 migrate')
    expect(p).toContain('pkg_installer')
  })
})

describe('extractJson', () => {
  it('容忍代码块包裹', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })
  it('容忍前后多余文字', () => {
    expect(extractJson('好的，结果是 {"a":2} 完毕')).toEqual({ a: 2 })
  })
  it('无 JSON 抛出', () => {
    expect(() => extractJson('没有对象')).toThrow()
  })
})

describe('parseAdvice', () => {
  it('解析完整结构并标记 ai_generated', () => {
    const a = parseAdvice('{"summary":"是临时文件","basis":["在Temp目录"],"risks":["无"],"recommendation":"可清理","uncertainty":"无"}')
    expect(a.summary).toBe('是临时文件')
    expect(a.basis).toEqual(['在Temp目录'])
    expect(a.ai_generated).toBe(true)
  })
  it('缺 summary 抛出', () => {
    expect(() => parseAdvice('{"basis":[]}')).toThrow()
  })
  it('basis 为字符串时归一为数组', () => {
    const a = parseAdvice('{"summary":"x","basis":"单条依据"}')
    expect(a.basis).toEqual(['单条依据'])
  })
})

describe('templateAdvice 降级', () => {
  it('ai_generated=false 且复用规则解释', () => {
    const a = templateAdvice(input)
    expect(a.ai_generated).toBe(false)
    expect(a.summary).toContain('系统临时文件')
  })
  it('高风险项给出不要手动删除的提示', () => {
    const a = templateAdvice({ ...input, risk_level: 'high', default_action: 'none' })
    expect(a.risks.join('')).toContain('请勿手动删除')
  })
})

describe('parseRule', () => {
  it('解析为最低优先级、delete_policy=none 的草案', () => {
    const r = parseRule('{"name":"清理旧安装包","category":"pkg_installer","match":{"path_globs":["%USERPROFILE%\\\\Downloads\\\\*.exe"]},"risk_level":"low","default_action":"clean","explain":"清理下载目录安装包"}')
    expect(r.priority_class).toBe(5)
    expect(r.delete_policy).toBe('none')
    expect(r.match.path_globs.length).toBe(1)
  })
  it('缺 path_globs 抛出', () => {
    expect(() => parseRule('{"name":"x","match":{}}')).toThrow()
  })
})
