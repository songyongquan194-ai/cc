import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { Rule } from '@shared/types'

/**
 * 加载内置规则 builtin.json。
 * 打包后位于 process.resourcesPath/rules；开发期位于项目根 rules/。
 */
export function loadBuiltinRules(resourcesPath?: string): Rule[] {
  const candidates = [
    resourcesPath ? join(resourcesPath, 'rules', 'builtin.json') : '',
    join(__dirname, '..', '..', 'rules', 'builtin.json'),
    join(process.cwd(), 'rules', 'builtin.json')
  ].filter(Boolean)

  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, 'utf-8')) as Rule[]
      } catch {
        // 损坏则尝试下一个候选
      }
    }
  }
  return []
}
