import { describe, it, expect } from 'vitest'
import { RuleEngine } from '../RuleEngine'
import type { FileMeta, Rule } from '@shared/types'

const env = { LOCALAPPDATA: 'C:\\Users\\Alex\\AppData\\Local' } as NodeJS.ProcessEnv

function meta(path: string, over: Partial<FileMeta> = {}): FileMeta {
  return {
    path,
    size_bytes: 1000,
    mtime: new Date(Date.now() - 10 * 86_400_000).toISOString(),
    atime: null,
    ext: '.' + (path.split('.').pop() ?? ''),
    is_dir: false,
    is_symlink: false,
    ...over
  }
}

const cacheRule: Rule = {
  name: 'Chrome Cache',
  category: 'browser_cache',
  match: { path_globs: ['%LOCALAPPDATA%\\Google\\Chrome\\User Data\\*\\Cache\\*'] },
  risk_level: 'safe',
  default_action: 'clean',
  delete_policy: 'delete_children_only',
  requires_app_closed: false,
  explain: 'cache',
  priority_class: 3
}

// 一条范围更宽、风险更高的保护规则，覆盖整个 Chrome 目录
const protectRule: Rule = {
  name: 'Chrome Profile',
  category: 'browser_profile',
  match: { path_globs: ['%LOCALAPPDATA%\\Google\\Chrome\\User Data\\Default\\*'] },
  risk_level: 'high',
  default_action: 'none',
  delete_policy: 'none',
  requires_app_closed: false,
  explain: 'profile',
  priority_class: 2
}

describe('RuleEngine 优先级裁决', () => {
  it('高优先级保护规则不能被低优先级清理规则覆盖', () => {
    // 故意把低优先级规则放前面，验证排序与先命中即止
    const engine = new RuleEngine([cacheRule, protectRule], env)
    const c = engine.classify(
      meta('C:\\Users\\Alex\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Login Data')
    )
    expect(c.matched_rule).toBe('Chrome Profile')
    expect(c.risk_level).toBe('high')
    expect(c.default_action).toBe('none')
  })

  it('普通缓存文件命中清理规则', () => {
    const engine = new RuleEngine([cacheRule, protectRule], env)
    const c = engine.classify(
      meta('C:\\Users\\Alex\\AppData\\Local\\Google\\Chrome\\User Data\\Profile 1\\Cache\\f_001')
    )
    expect(c.matched_rule).toBe('Chrome Cache')
    expect(c.default_action).toBe('clean')
  })

  it('禁止目录无论规则如何都判为 forbidden', () => {
    const engine = new RuleEngine([cacheRule], env)
    const c = engine.classify(meta('C:\\Windows\\System32\\drivers\\etc\\hosts'))
    expect(c.risk_level).toBe('forbidden')
    expect(c.default_action).toBe('none')
  })

  it('无命中返回 uncategorized 且不处理', () => {
    const engine = new RuleEngine([cacheRule], env)
    const c = engine.classify(meta('C:\\Users\\Alex\\Documents\\report.docx'))
    expect(c.category).toBe('uncategorized')
    expect(c.default_action).toBe('none')
  })

  it('min_age_days 未达不命中', () => {
    const rule: Rule = { ...cacheRule, match: { ...cacheRule.match, min_age_days: 30 } }
    const engine = new RuleEngine([rule], env)
    const fresh = meta(
      'C:\\Users\\Alex\\AppData\\Local\\Google\\Chrome\\User Data\\Profile 1\\Cache\\f_001',
      { mtime: new Date().toISOString() }
    )
    expect(engine.classify(fresh).category).toBe('uncategorized')
  })

  it('ext_in 与 min_size 过滤', () => {
    const rule: Rule = {
      name: 'Big ISO',
      category: 'pkg_installer',
      match: { path_globs: ['C:\\Users\\Alex\\Downloads\\*'], ext_in: ['.iso'], min_size_bytes: 1000 },
      risk_level: 'low',
      default_action: 'migrate',
      delete_policy: 'delete_self',
      requires_app_closed: false,
      explain: 'iso',
      priority_class: 4
    }
    const engine = new RuleEngine([rule], env)
    const hit = meta('C:\\Users\\Alex\\Downloads\\win.iso', { size_bytes: 5000 })
    expect(engine.classify(hit).matched_rule).toBe('Big ISO')
    const tooSmall = meta('C:\\Users\\Alex\\Downloads\\win.iso', { size_bytes: 100 })
    expect(engine.classify(tooSmall).category).toBe('uncategorized')
    const wrongExt = meta('C:\\Users\\Alex\\Downloads\\note.txt', { size_bytes: 5000 })
    expect(engine.classify(wrongExt).category).toBe('uncategorized')
  })
})
