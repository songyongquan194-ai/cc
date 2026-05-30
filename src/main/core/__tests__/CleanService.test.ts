import { describe, it, expect } from 'vitest'
import { CleanService } from '../CleanService'
import { SafetyGuard } from '../SafetyGuard'
import { MemoryFsAdapter } from './memoryFs'
import type { ScanItem } from '@shared/types'

function item(over: Partial<ScanItem> & { path: string }): ScanItem {
  return {
    size_bytes: 100,
    mtime: null,
    atime: null,
    ext: '.tmp',
    category: 'sys_temp',
    risk_level: 'safe',
    default_action: 'clean',
    matched_rule: 'r',
    explain: '',
    delete_policy: 'delete_self',
    ...over
  }
}

function setup(excluded: string[] = []) {
  const fs = new MemoryFsAdapter()
  const guard = new SafetyGuard(fs, { excludedDirs: excluded, systemDrive: 'C:' })
  return { fs, svc: new CleanService(fs, guard) }
}

describe('CleanService', () => {
  it('删除 safe 项并累计释放空间', async () => {
    const { fs, svc } = setup()
    fs.set('C:\\Users\\Alex\\Temp\\a.tmp', { size: 100 })
    fs.set('C:\\Users\\Alex\\Temp\\b.tmp', { size: 250 })
    const report = await svc.clean([
      item({ path: 'C:\\Users\\Alex\\Temp\\a.tmp', size_bytes: 100 }),
      item({ path: 'C:\\Users\\Alex\\Temp\\b.tmp', size_bytes: 250 })
    ])
    expect(report.cleaned).toBe(2)
    expect(report.freed_bytes).toBe(350)
    expect(await fs.exists('C:\\Users\\Alex\\Temp\\a.tmp')).toBe(false)
  })

  it('高风险项被硬拒绝（不删除）', async () => {
    const { fs, svc } = setup()
    fs.set('C:\\Users\\Alex\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Login Data', { size: 999 })
    const report = await svc.clean([
      item({
        path: 'C:\\Users\\Alex\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Login Data',
        risk_level: 'high'
      })
    ])
    expect(report.cleaned).toBe(0)
    expect(report.skipped).toBe(1)
    expect(await fs.exists('C:\\Users\\Alex\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Login Data')).toBe(true)
  })

  it('占用文件跳过、不计入释放', async () => {
    const { fs, svc } = setup()
    fs.set('C:\\Users\\Alex\\Temp\\locked.tmp', { size: 100, locked: true })
    const report = await svc.clean([item({ path: 'C:\\Users\\Alex\\Temp\\locked.tmp' })])
    expect(report.skipped).toBe(1)
    expect(report.freed_bytes).toBe(0)
    expect(await fs.exists('C:\\Users\\Alex\\Temp\\locked.tmp')).toBe(true)
  })

  it('排除目录内的文件被跳过', async () => {
    const { fs, svc } = setup(['C:\\Users\\Alex\\Keep'])
    fs.set('C:\\Users\\Alex\\Keep\\a.tmp', { size: 100 })
    const report = await svc.clean([item({ path: 'C:\\Users\\Alex\\Keep\\a.tmp' })])
    expect(report.skipped).toBe(1)
    expect(await fs.exists('C:\\Users\\Alex\\Keep\\a.tmp')).toBe(true)
  })

  it('非 clean 动作项跳过', async () => {
    const { fs, svc } = setup()
    fs.set('C:\\Users\\Alex\\Downloads\\big.iso', { size: 5000 })
    const report = await svc.clean([
      item({ path: 'C:\\Users\\Alex\\Downloads\\big.iso', risk_level: 'low', default_action: 'migrate' })
    ])
    expect(report.skipped).toBe(1)
    expect(report.cleaned).toBe(0)
  })

  it('取消令牌中止后续清理', async () => {
    const { fs, svc } = setup()
    fs.set('C:\\Users\\Alex\\Temp\\a.tmp', { size: 100 })
    const signal = { cancelled: true }
    const report = await svc.clean([item({ path: 'C:\\Users\\Alex\\Temp\\a.tmp' })], { signal })
    expect(report.cleaned).toBe(0)
  })
})
