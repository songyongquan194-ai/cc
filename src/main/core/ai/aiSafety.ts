// AI 输出安全后处理（PRD §13.2/§13.4）。纯函数，无 I/O，可单测。
// 不信任模型输出：任何越界（删除高风险/碰禁止目录/提权动作）都在此被收敛或拒绝。

import type { AIAdvice, RiskLevel, Rule } from '@shared/types'
import type { PlatformProfile } from '../platform'
import { getActiveProfile } from '../platform'

/** 默认绝不自动处理的风险等级。AI 不得建议自动删除这些项。 */
export const RISK_NEVER_AUTO = new Set<RiskLevel>(['high', 'forbidden'])

/** 危险措辞：出现在高风险项建议里需要被剔除/降级。 */
const DELETE_WORDS = /(删除|清除|清空|移除|彻底删|永久删|delete|remove|rm\s|wipe|purge)/i

/**
 * 收敛 AI 解释：高风险/禁止项的建议里若出现“删除”等措辞，替换为安全口径，
 * 并追加风险提示。绝不让 AI 把不可处理项说成可删除。
 */
export function sanitizeAdvice(advice: AIAdvice, risk: RiskLevel): AIAdvice {
  if (!RISK_NEVER_AUTO.has(risk)) return advice
  const safeRec = '该项为高风险/系统关键项，本工具默认不处理，也不会自动对其执行任何操作；如确有需要请你自行手动判断。'
  const risks = [...advice.risks]
  const warn = '注意：这是高风险/禁止项，删除可能导致系统或程序异常，已忽略任何自动删除建议。'
  if (!risks.includes(warn)) risks.unshift(warn)
  return {
    ...advice,
    // 若推荐里含删除措辞，整体替换为安全口径；否则保留但仍补充风险。
    recommendation: DELETE_WORDS.test(advice.recommendation) ? safeRec : advice.recommendation,
    risks
  }
}

export interface RuleSanitizeResult {
  ok: boolean
  rule?: Rule
  warnings: string[]
  error?: string
}

const ALLOWED_RULE_RISK = new Set<RiskLevel>(['safe', 'low', 'medium'])

/**
 * 收敛 NL 生成的规则草案：
 * - 风险等级超过 medium → 拒绝（不允许 AI 造高风险规则）；
 * - default_action 只允许 clean/migrate，其余降级为 migrate；
 * - delete_policy 强制 none，requires_app_closed=false，priority_class=5（最低）；
 * - 任一 glob 命中禁止目录 → 整条拒绝；
 * 收敛后规则仍需进入预览确认，用户点确认才生效。
 */
export function sanitizeRule(
  rule: Rule,
  env: NodeJS.ProcessEnv = process.env,
  profile: PlatformProfile = getActiveProfile()
): RuleSanitizeResult {
  const warnings: string[] = []

  if (!ALLOWED_RULE_RISK.has(rule.risk_level)) {
    return {
      ok: false,
      warnings,
      error: `规则风险等级 ${rule.risk_level} 不被允许：AI 不能生成高风险或禁止规则。`
    }
  }

  // glob 不得命中禁止目录。对每个 glob 用其字面前缀与展开后路径做判定。
  for (const glob of rule.match.path_globs) {
    const expanded = profile.expandEnv(glob, env)
    const literal = expanded.replace(/[*?].*$/, '').replace(/[\\/]+$/, '')
    if (literal && profile.isForbidden(literal)) {
      return {
        ok: false,
        warnings,
        error: `规则路径命中系统禁止目录，已拒绝：${glob}`
      }
    }
    // 校验 glob 可编译，避免坏正则
    try {
      profile.globToRegExp(expanded)
    } catch {
      return { ok: false, warnings, error: `规则路径模式无效：${glob}` }
    }
  }

  let action = rule.default_action
  if (action !== 'clean' && action !== 'migrate') {
    warnings.push(`已将动作 ${action} 降级为 migrate（仅允许 clean/migrate）。`)
    action = 'migrate'
  }
  // 中等风险一律走迁移而非清理（不确定先冷藏）
  if (rule.risk_level === 'medium' && action === 'clean') {
    warnings.push('中等风险项不直接清理，已改为迁移冷藏。')
    action = 'migrate'
  }

  const safe: Rule = {
    ...rule,
    default_action: action,
    delete_policy: 'none',
    requires_app_closed: false,
    priority_class: 5
  }
  return { ok: true, rule: safe, warnings }
}
