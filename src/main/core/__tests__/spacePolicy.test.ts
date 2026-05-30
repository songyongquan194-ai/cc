import { describe, it, expect } from 'vitest'
import { backupThresholdBytes, evaluateMigration } from '../spacePolicy'

const GB = 1024 ** 3

describe('spacePolicy', () => {
  it('阈值取 max(10GB, 总容量×5%)', () => {
    expect(backupThresholdBytes(100 * GB)).toBe(10 * GB) // 5% = 5GB < 10GB → 10GB
    expect(backupThresholdBytes(1000 * GB)).toBe(50 * GB) // 5% = 50GB > 10GB → 50GB
  })

  it('正常迁移：允许并给出三数字', () => {
    const plan = evaluateMigration({
      backup: { free: 200 * GB, total: 500 * GB },
      system: { free: 50 * GB, total: 256 * GB },
      batchBytes: 20 * GB
    })
    expect(plan.allowed).toBe(true)
    expect(plan.c_freed_bytes).toBe(20 * GB)
    expect(plan.backup_used_bytes).toBe(20 * GB)
    expect(plan.backup_free_after).toBe(180 * GB)
    expect(plan.system_free_after).toBe(70 * GB)
  })

  it('单次迁移超过备份盘可用 80% → 拒绝', () => {
    const plan = evaluateMigration({
      backup: { free: 100 * GB, total: 500 * GB },
      system: { free: 50 * GB, total: 256 * GB },
      batchBytes: 90 * GB
    })
    expect(plan.allowed).toBe(false)
    expect(plan.error_code).toBe('E_BACKUP_LOW_SPACE')
  })

  it('迁后备份盘剩余低于阈值 → 拒绝', () => {
    const plan = evaluateMigration({
      backup: { free: 55 * GB, total: 1000 * GB }, // 阈值 50GB
      system: { free: 50 * GB, total: 256 * GB },
      batchBytes: 40 * GB // 迁后剩 15GB < 50GB
    })
    expect(plan.allowed).toBe(false)
    expect(plan.error_code).toBe('E_BACKUP_LOW_SPACE')
  })

  it('迁后 C 盘剩余 <15% → 允许但告警', () => {
    const plan = evaluateMigration({
      backup: { free: 200 * GB, total: 500 * GB },
      system: { free: 10 * GB, total: 256 * GB }, // 迁后 (10+20)/256 ≈ 11.7%
      batchBytes: 20 * GB
    })
    expect(plan.allowed).toBe(true)
    expect(plan.warnings.length).toBe(1)
  })
})
