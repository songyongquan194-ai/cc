import type { Rule } from '@shared/types'
import { RuleEngine } from './RuleEngine'

/**
 * 加载内置规则 + 用户规则，构建 RuleEngine。
 * 内置规则随包发布于 rules/builtin.json；用户规则由调用方从 DB 读出传入。
 */
export function buildRuleEngine(
  builtinRules: Rule[],
  userRules: Rule[] = [],
  env: NodeJS.ProcessEnv = process.env
): RuleEngine {
  // 用户排除规则与高风险保护应有更高优先级（更小 priority_class），
  // 由各规则自身的 priority_class 决定，RuleEngine 内部已排序。
  return new RuleEngine([...builtinRules, ...userRules], env)
}
