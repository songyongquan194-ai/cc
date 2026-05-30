import { Tag } from 'antd'

export const OP_LABEL: Record<string, string> = {
  scan: '扫描',
  clean: '清理',
  migrate: '迁移',
  restore: '恢复',
  delete_cold: '永久删除',
  extend_cold: '延长冷藏',
  ai: 'AI 顾问'
}

const STATUS_LABEL: Record<string, string> = {
  success: '成功',
  failed: '失败',
  skipped: '跳过',
  source_kept: '源保留'
}

const STATUS_COLOR: Record<string, string> = {
  success: 'green',
  failed: 'red',
  skipped: 'default',
  source_kept: 'orange'
}

export function opStatusTag(status: string): JSX.Element {
  return <Tag color={STATUS_COLOR[status] ?? 'default'}>{STATUS_LABEL[status] ?? status}</Tag>
}
