import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { Rule } from '@shared/types'

/**
 * 加载内置规则。darwin 优先 builtin.mac.json，其余用 builtin.json。
 * 打包后位于 process.resourcesPath/rules；开发期位于项目根 rules/。
 */
export function loadBuiltinRules(resourcesPath?: string, profileId?: string): Rule[] {
  const file = profileId === 'darwin' ? 'builtin.mac.json' : 'builtin.json'
  const dirs = [
    resourcesPath ? join(resourcesPath, 'rules') : '',
    join(__dirname, '..', '..', 'rules'),
    join(process.cwd(), 'rules')
  ].filter(Boolean)

  // 先按平台文件找；找不到（如 mac 规则缺失）再回退到通用 builtin.json。
  const candidates = [
    ...dirs.map((d) => join(d, file)),
    ...dirs.map((d) => join(d, 'builtin.json'))
  ]

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
