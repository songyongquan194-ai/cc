/**
 * 迁移空间阈值策略，实现 TECH_DESIGN.md §10 决策：
 * - 备份盘最低剩余 = max(10GB, 总容量×5%)
 * - 单次迁移量 ≤ 备份盘当前可用×80%
 * - 迁移后 C 盘剩余占比 < 15% → 仅告警（不阻止）
 */

const GB = 1024 ** 3

export interface DriveSpace {
  free: number
  total: number
}

export interface MigrationPlanInput {
  backup: DriveSpace
  system: DriveSpace // C 盘
  batchBytes: number // 本次迁移合计字节
}

export interface MigrationPlan {
  allowed: boolean
  error_code?: string
  /** C 盘将释放 */
  c_freed_bytes: number
  /** 备份盘将占用 */
  backup_used_bytes: number
  /** 迁移后备份盘剩余 */
  backup_free_after: number
  /** 迁移后 C 盘剩余 */
  system_free_after: number
  /** 备份盘最低剩余阈值 */
  backup_threshold: number
  /** 非阻断性提醒 */
  warnings: string[]
}

export function backupThresholdBytes(total: number): number {
  return Math.max(10 * GB, Math.floor(total * 0.05))
}

export function evaluateMigration(input: MigrationPlanInput): MigrationPlan {
  const { backup, system, batchBytes } = input
  const threshold = backupThresholdBytes(backup.total)
  const backupFreeAfter = backup.free - batchBytes
  const systemFreeAfter = system.free + batchBytes
  const warnings: string[] = []

  const plan: MigrationPlan = {
    allowed: true,
    c_freed_bytes: batchBytes,
    backup_used_bytes: batchBytes,
    backup_free_after: backupFreeAfter,
    system_free_after: systemFreeAfter,
    backup_threshold: threshold,
    warnings
  }

  // 单次迁移量 ≤ 备份盘当前可用×80%
  if (batchBytes > backup.free * 0.8) {
    plan.allowed = false
    plan.error_code = 'E_BACKUP_LOW_SPACE'
    return plan
  }
  // 迁移后备份盘剩余低于阈值 → 不允许提交
  if (backupFreeAfter < threshold) {
    plan.allowed = false
    plan.error_code = 'E_BACKUP_LOW_SPACE'
    return plan
  }
  // 迁后 C 盘剩余 < 15% → 告警
  if (system.total > 0 && systemFreeAfter / system.total < 0.15) {
    warnings.push('迁移后系统盘剩余仍低于 15%，建议进一步清理或迁移更多内容。')
  }
  return plan
}
