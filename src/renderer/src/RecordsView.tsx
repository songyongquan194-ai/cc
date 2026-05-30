import { useEffect, useState } from 'react'
import { Button, Card, Segmented, Space, Table, Typography, Tooltip, message } from 'antd'
import { formatBytes, catLabel } from './format'
import { OP_LABEL, opStatusTag } from './opMeta'

const { Text } = Typography

type OperationRow = Awaited<ReturnType<Window['api']['ops']['list']>>[number]

const FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'scan', label: '扫描' },
  { value: 'clean', label: '清理' },
  { value: 'migrate', label: '迁移' },
  { value: 'restore', label: '恢复' },
  { value: 'delete_cold', label: '永久删除' },
  { value: 'failed', label: '仅失败' }
]

export default function RecordsView(): JSX.Element {
  const [rows, setRows] = useState<OperationRow[]>([])
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  const load = async (f = filter): Promise<void> => {
    setLoading(true)
    try {
      setRows(await window.api.ops.list(f, 500))
    } catch (e) {
      message.error('加载记录失败：' + String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(filter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  const doExport = async (format: 'json' | 'csv'): Promise<void> => {
    setExporting(true)
    try {
      const r = await window.api.ops.export(format, filter)
      if (r.ok) message.success('已导出到：' + r.path)
      else if (!r.canceled) message.error('导出失败：' + (r.error ?? '未知原因'))
    } finally {
      setExporting(false)
    }
  }

  const cols = [
    {
      title: '时间',
      dataIndex: 'ts',
      width: 160,
      render: (t: string) => new Date(t).toLocaleString()
    },
    {
      title: '类型',
      dataIndex: 'op_type',
      width: 90,
      render: (t: string) => OP_LABEL[t] ?? t
    },
    {
      title: '路径',
      dataIndex: 'path',
      ellipsis: true,
      render: (p: string | null, row: OperationRow) =>
        p ? (
          <Tooltip title={row.dest_path ? `${p}\n→ ${row.dest_path}` : p}>
            <Text ellipsis>{p}</Text>
          </Tooltip>
        ) : (
          <Text type="secondary">{row.action ?? '—'}</Text>
        )
    },
    {
      title: '分类',
      dataIndex: 'category',
      width: 120,
      render: (c: string | null) => (c ? catLabel(c) : '—')
    },
    {
      title: '大小',
      dataIndex: 'size_bytes',
      width: 90,
      render: (b: number | null) => (b ? formatBytes(b) : '—')
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      render: (s: string) => opStatusTag(s)
    },
    {
      title: '错误',
      dataIndex: 'error_code',
      width: 160,
      render: (c: string | null, row: OperationRow) =>
        c ? (
          <Tooltip title={row.error_detail ?? ''}>
            <Text type="danger" style={{ fontSize: 12 }}>{c}</Text>
          </Tooltip>
        ) : (
          '—'
        )
    }
  ]

  return (
    <Card
      size="small"
      title="操作记录"
      extra={
        <Space>
          <Button size="small" loading={exporting} onClick={() => void doExport('csv')}>
            导出 CSV
          </Button>
          <Button size="small" loading={exporting} onClick={() => void doExport('json')}>
            导出 JSON
          </Button>
          <Button size="small" onClick={() => void load()} loading={loading}>
            刷新
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Segmented options={FILTERS} value={filter} onChange={(v) => setFilter(v as string)} />
        <Text type="secondary" style={{ fontSize: 12 }}>
          记录扫描 / 清理 / 迁移 / 恢复 / 删除等全部操作，含失败原因。导出按当前筛选条件保存。
        </Text>
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={rows}
          columns={cols}
          pagination={{ pageSize: 15 }}
        />
      </Space>
    </Card>
  )
}
