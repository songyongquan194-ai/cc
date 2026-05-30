import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { NodeFsAdapter } from '../NodeFsAdapter'
import { ScanEngine } from '../ScanEngine'
import { RuleEngine } from '../RuleEngine'
import { walk } from '../Walker'
import type { Rule, ScanItem } from '@shared/types'

let root: string
let symlinkOk = false

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'cdc-scan-'))
  mkdirSync(join(root, 'Cache'))
  writeFileSync(join(root, 'Cache', 'a.tmp'), 'x'.repeat(100))
  writeFileSync(join(root, 'Cache', 'b.tmp'), 'y'.repeat(200))
  writeFileSync(join(root, 'keep.txt'), 'z'.repeat(50))
  writeFileSync(join(root, 'big.mp4'), Buffer.alloc(1024 * 50))
  try {
    symlinkSync(join(root, 'Cache'), join(root, 'link'), 'junction')
    symlinkOk = true
  } catch {
    symlinkOk = false // 无权限创建符号链接则跳过相关断言
  }
})

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

function cacheRule(): Rule {
  return {
    name: 'TmpCache',
    category: 'browser_cache',
    match: { path_globs: [join(root, 'Cache') + '\\*'] },
    risk_level: 'safe',
    default_action: 'clean',
    delete_policy: 'delete_children_only',
    requires_app_closed: false,
    explain: 'cache',
    priority_class: 4
  }
}

describe('NodeFsAdapter + Walker (real fs)', () => {
  it('真实目录遍历且不跟随 junction', async () => {
    const fs = new NodeFsAdapter()
    const files: string[] = []
    let symlinkSeen = false
    for await (const m of walk(fs, root, { maxDepth: 5, excludedDirs: [] })) {
      if (m.is_symlink) symlinkSeen = true
      else if (!m.is_dir) files.push(m.path)
    }
    // 不跟随 junction：link 内部文件不会以 link\ 前缀重复出现
    expect(files.some((p) => p.toLowerCase().includes('\\link\\'))).toBe(false)
    if (symlinkOk) expect(symlinkSeen).toBe(true)
  })

  it('ScanEngine 在真实磁盘上分类并聚合', async () => {
    const fs = new NodeFsAdapter()
    const engine = new ScanEngine(fs, new RuleEngine([cacheRule()]))
    const items: ScanItem[] = []
    const res = await engine.scan([root], {
      maxDepth: 5,
      excludedDirs: [],
      largeFileMinBytes: 1024 * 10,
      onBatch: (b) => items.push(...b)
    })
    const cacheItems = items.filter((i) => i.matched_rule === 'TmpCache')
    expect(cacheItems.length).toBe(2)
    expect(res.safe_bytes).toBe(300)
    // big.mp4（50KB > 10KB 阈值，未匹配规则，惰性媒体）应作为大文件
    expect(items.some((i) => i.matched_rule === '__large_file__')).toBe(true)
    // keep.txt 不匹配、非大文件 → 不记录
    expect(items.some((i) => i.path.endsWith('keep.txt'))).toBe(false)
  })

  it('diskSpace 返回正值', async () => {
    const { free, total } = await new NodeFsAdapter().diskSpace(root)
    expect(total).toBeGreaterThan(0)
    expect(free).toBeGreaterThanOrEqual(0)
  })
})
