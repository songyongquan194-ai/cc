import type { Classification, FileMeta, Rule } from '@shared/types'
import type { PlatformProfile } from './platform'
import { getActiveProfile } from './platform'

interface CompiledRule extends Rule {
  _regexps: RegExp[]
}

/**
 * 规则匹配与优先级裁决。实现 TECH_DESIGN.md §4.2：
 * 按 priority_class 升序裁决，先命中即终止；低优先级不能覆盖高优先级。
 * 路径展开/匹配/禁止判断经 PlatformProfile 抽象。
 */
export class RuleEngine {
  private compiled: CompiledRule[]
  private readonly p: PlatformProfile

  constructor(rules: Rule[], env: NodeJS.ProcessEnv = process.env, profile?: PlatformProfile) {
    this.p = profile ?? getActiveProfile()
    this.compiled = rules
      .map((r) => ({
        ...r,
        _regexps: r.match.path_globs.map((g) => this.p.globToRegExp(this.p.expandEnv(g, env)))
      }))
      .sort((a, b) => a.priority_class - b.priority_class)
  }

  /** 对单个文件/目录裁决分类。无命中返回 uncategorized。 */
  classify(meta: FileMeta): Classification {
    const norm = this.p.normalizePath(meta.path)

    // 禁止目录硬规则（class 0）优先于一切，即使没有显式 rule 命中。
    if (this.p.isForbidden(norm)) {
      return {
        category: 'uncategorized',
        risk_level: 'forbidden',
        default_action: 'none',
        matched_rule: '__forbidden__',
        explain: '系统关键目录，禁止处理。',
        delete_policy: 'none'
      }
    }

    for (const rule of this.compiled) {
      if (this.matches(rule, meta, norm)) {
        return {
          category: rule.category,
          risk_level: rule.risk_level,
          default_action: rule.default_action,
          matched_rule: rule.name,
          explain: rule.explain,
          delete_policy: rule.delete_policy
        }
      }
    }

    return {
      category: 'uncategorized',
      risk_level: 'low',
      default_action: 'none',
      matched_rule: null,
      explain: '未匹配到已知规则，默认不处理。',
      delete_policy: 'none'
    }
  }

  private matches(rule: CompiledRule, meta: FileMeta, norm: string): boolean {
    const m = rule.match

    const pathHit = rule._regexps.some((re) => re.test(norm))
    if (!pathHit) return false

    if (m.ext_in && m.ext_in.length > 0) {
      const ext = meta.ext.toLowerCase()
      if (!m.ext_in.map((e) => e.toLowerCase()).includes(ext)) return false
    }

    if (m.min_size_bytes && meta.size_bytes < m.min_size_bytes) return false

    if (m.min_age_days && meta.mtime) {
      const ageDays = (Date.now() - new Date(meta.mtime).getTime()) / 86_400_000
      if (ageDays < m.min_age_days) return false
    }

    return true
  }
}
