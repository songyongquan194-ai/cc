import { describe, it, expect } from 'vitest'
import { findDuplicates, reclaimableBytes, type DupFile } from '../DuplicateFinder'

const f = (path: string, size: number, mtime: string | null = null): DupFile => ({
  path,
  size_bytes: size,
  mtime,
  atime: null,
  category: null
})

describe('DuplicateFinder', () => {
  it('把同名同大小（含副本标记）归为一组', () => {
    const groups = findDuplicates([
      f('C:\\Users\\Alex\\Documents\\合同.pdf', 2048),
      f('C:\\Users\\Alex\\Downloads\\合同 - 副本.pdf', 2048),
      f('C:\\Users\\Alex\\Downloads\\无关.bin', 999)
    ])
    expect(groups.length).toBe(1)
    expect(groups[0].count).toBe(2)
  })

  it('不同大小不归组', () => {
    const groups = findDuplicates([
      f('C:\\a\\report.docx', 100),
      f('C:\\b\\report.docx', 200)
    ])
    expect(groups.length).toBe(0)
  })

  it('建议保留 Documents 中的正式文件，而非 Downloads 副本', () => {
    const [g] = findDuplicates([
      f('C:\\Users\\Alex\\Documents\\合同.pdf', 2048),
      f('C:\\Users\\Alex\\Downloads\\合同 - 副本.pdf', 2048)
    ])
    expect(g.suggested_keep).toBe('C:\\Users\\Alex\\Documents\\合同.pdf')
    expect(g.reason).toContain('未做内容哈希确认')
  })

  it('忽略零字节与低于 minSize 的文件', () => {
    const groups = findDuplicates(
      [f('C:\\a\\x.tmp', 0), f('C:\\b\\x.tmp', 0), f('C:\\c\\y.log', 5), f('C:\\d\\y.log', 5)],
      { minSize: 10 }
    )
    expect(groups.length).toBe(0)
  })

  it('reclaimableBytes = 大小 ×（份数-1）', () => {
    const [g] = findDuplicates([
      f('C:\\a\\v.iso', 1000),
      f('C:\\b\\v.iso', 1000),
      f('C:\\c\\v.iso', 1000)
    ])
    expect(g.count).toBe(3)
    expect(reclaimableBytes(g)).toBe(2000)
  })

  it('按可回收空间降序排序', () => {
    const groups = findDuplicates([
      f('C:\\a\\small.dat', 100),
      f('C:\\b\\small.dat', 100),
      f('C:\\a\\big.dat', 5000),
      f('C:\\b\\big.dat', 5000)
    ])
    expect(groups[0].size_bytes).toBe(5000)
  })
})
