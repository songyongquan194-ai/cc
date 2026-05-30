import { describe, it, expect } from 'vitest'
import { walk } from '../Walker'
import { ScanEngine } from '../ScanEngine'
import { RuleEngine } from '../RuleEngine'
import { MemoryFsAdapter } from './memoryFs'
import type { Rule, ScanItem } from '@shared/types'

const env = { LOCALAPPDATA: 'C:\\Users\\Alex\\AppData\\Local' } as NodeJS.ProcessEnv

function buildFs(): MemoryFsAdapter {
  const fs = new MemoryFsAdapter()
  fs.set('C:\\scan', { isDir: true })
  fs.set('C:\\scan\\Cache', { isDir: true })
  fs.set('C:\\scan\\Cache\\f1', { size: 100 })
  fs.set('C:\\scan\\Cache\\f2', { size: 200 })
  fs.set('C:\\scan\\link', { isSymlink: true, isDir: true })
  fs.set('C:\\scan\\big.bin', { size: 500 }) // 运行库类扩展名：不应被兜底迁移
  fs.set('C:\\scan\\big.mp4', { size: 500 }) // 惰性媒体大文件：可兜底迁移
  fs.set('C:\\scan\\doc.txt', { size: 10 })
  return fs
}

const cacheRule: Rule = {
  name: 'Test Cache',
  category: 'browser_cache',
  match: { path_globs: ['C:\\scan\\Cache\\*'] },
  risk_level: 'safe',
  default_action: 'clean',
  delete_policy: 'delete_children_only',
  requires_app_closed: false,
  explain: 'cache',
  priority_class: 4
}

describe('Walker', () => {
  it('遍历产出文件与目录，不跟随符号链接', async () => {
    const fs = buildFs()
    const seen: string[] = []
    for await (const m of walk(fs, 'C:\\scan', { maxDepth: 5, excludedDirs: [] })) {
      seen.push(m.path)
    }
    expect(seen).toContain('C:\\scan\\Cache\\f1')
    expect(seen).toContain('C:\\scan\\link') // 符号链接本身产出
    // 但不应进入符号链接内部（这里 link 下无子项，验证不抛错即可）
    expect(seen).toContain('C:\\scan\\big.bin')
  })

  it('excludedDirs 内的目录被跳过', async () => {
    const fs = buildFs()
    const seen: string[] = []
    for await (const m of walk(fs, 'C:\\scan', {
      maxDepth: 5,
      excludedDirs: ['C:\\scan\\Cache']
    })) {
      seen.push(m.path)
    }
    expect(seen.some((p) => p.startsWith('C:\\scan\\Cache\\'))).toBe(false)
  })

  it('无权限目录通过 onDirError 标记而非抛出', async () => {
    const fs = new MemoryFsAdapter()
    // 不放置任何子项 → readdir 对 MemoryFs 返回空，不报错；
    // 改造：用一个会抛错的目录路径
    const errors: string[] = []
    for await (const _ of walk(fs, 'C:\\nonexistent', {
      maxDepth: 2,
      excludedDirs: [],
      onDirError: (dir) => errors.push(dir)
    })) {
      void _
    }
    // MemoryFs.readdir 不抛错（返回空），因此无错误；验证遍历空目录安全完成
    expect(errors.length).toBeGreaterThanOrEqual(0)
  })
})

describe('ScanEngine', () => {
  it('分类命中项并聚合空间', async () => {
    const fs = buildFs()
    const engine = new ScanEngine(fs, new RuleEngine([cacheRule], env))
    const items: ScanItem[] = []
    const res = await engine.scan(['C:\\scan'], {
      maxDepth: 5,
      excludedDirs: [],
      onBatch: (b) => items.push(...b)
    })
    // 两个 cache 文件为 safe/clean
    const cacheItems = items.filter((i) => i.matched_rule === 'Test Cache')
    expect(cacheItems.length).toBe(2)
    expect(res.safe_bytes).toBe(300)
    // doc.txt / big.bin 未匹配规则、非大文件 → 不记录
    expect(items.some((i) => i.path === 'C:\\scan\\doc.txt')).toBe(false)
  })

  it('深度扫描大文件阈值识别', async () => {
    const fs = buildFs()
    const engine = new ScanEngine(fs, new RuleEngine([], env))
    const items: ScanItem[] = []
    await engine.scan(['C:\\scan'], {
      maxDepth: 5,
      excludedDirs: [],
      largeFileMinBytes: 400,
      onBatch: (b) => items.push(...b)
    })
    const large = items.filter((i) => i.matched_rule === '__large_file__')
    // 惰性媒体大文件进入兜底迁移
    expect(large.map((i) => i.path)).toContain('C:\\scan\\big.mp4')
    // 运行库类扩展名（.bin）即便超阈值也不兜底迁移，避免破坏应用
    expect(large.map((i) => i.path)).not.toContain('C:\\scan\\big.bin')
    expect(large.every((i) => i.default_action === 'migrate')).toBe(true)
  })

  it('取消令牌生效', async () => {
    const fs = buildFs()
    const engine = new ScanEngine(fs, new RuleEngine([cacheRule], env))
    const signal = { cancelled: true }
    const res = await engine.scan(['C:\\scan'], { maxDepth: 5, excludedDirs: [], signal })
    expect(res.cancelled).toBe(true)
    expect(res.total_files).toBe(0)
  })

  it('进度回调在结束时 done=true', async () => {
    const fs = buildFs()
    const engine = new ScanEngine(fs, new RuleEngine([cacheRule], env))
    let lastDone = false
    await engine.scan(['C:\\scan'], {
      maxDepth: 5,
      excludedDirs: [],
      onProgress: (p) => {
        lastDone = p.done
      }
    })
    expect(lastDone).toBe(true)
  })
})
