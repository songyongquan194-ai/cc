import { useEffect, useState } from 'react'
import { Button, Card, Table, Tag, Typography, Space, message, Modal, Select, Empty, Alert } from 'antd'
import type { WatchItem, WatchStatus } from '@shared/types'
import { formatBytes, catLabel } from './format'

const { Text } = Typography

const PERIODS = [
  { value: 7, label: '7 天' },
  { value: 30, label: '30 天' },
  { value: 60, label: '60 天' },
  { value: 90, label: '90 天' }
]

const STATUS_META: Record<WatchStatus, { label: string; color: string }> = {
  watching: { label: '观察中', color: 'blue' },
  due: { label: '待处理（已到期）', color: 'red' },
  recent: { label: '近期使用', color: 'green' },
  missing: { label: '已消失', color: 'default' },
  ignored: { label: '已忽略', color: 'default' }
}

export default function WatchView(): JSX.Element {
  const [items, setItems] = useState<WatchItem[]>([])
  const [loading, setLoading] = useState(false)

  // 进入即刷新状态（到期/近期使用/消失），形成提醒闭环
  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      setItems(await window.api.watch.check())
    } catch (e) {
      message.error('加载观察列表失败：' + String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const dueCount = items.filter((i) => i.status === 'due').length

  const extend = (row: WatchItem): void => {
    let period = 30
    Modal.confirm({
      title: '继续观察',
      content: (
        <Space direction="vertical">
          <Text>从现在起重新计算提醒时间：</Text>
          <Select defaultValue={30} style={{ width: 160 }} options={PERIODS} onChange={(v) => (period = v)} />
        </Space>
      ),
      onOk: async () => {
        const r = await window.api.watch.extend(row.id, period)
        if (r.ok) {
          message.success('已续期')
          void load()
        }
      }
    })
  }

  const remove = async (row: WatchItem): Promise<void> => {
    const r = await window.api.watch.remove(row.id)
    if (r.ok) {
      message.success('已移出观察列表')
      void load()
    }
  }

  const ignore = async (row: WatchItem): Promise<void> => {
    const r = await window.api.watch.ignore(row.id)
    if (r.ok) {
      message.success('已忽略，不再提醒')
      void load()
    }
  }

  const cols = [
    { title: '路径', dataIndex: 'path', ellipsis: true },
    {
      title: '分类',
      dataIndex: 'category',
      width: 120,
      render: (c: string | null) => (c ? catLabel(c) : '—')
    },
    {
      title: '大小',
      dataIndex: 'size_bytes',
      width: 100,
      render: (b: number | null) => (b ? formatBytes(b) : '—')
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 140,
      render: (s: WatchStatus) => <Tag color={STATUS_META[s].color}>{STATUS_META[s].label}</Tag>
    },
    {
      title: '提醒时间',
      dataIndex: 'remind_at',
      width: 130,
      render: (t: string) => new Date(t).toLocaleDateString()
    },
    {
      title: '操作',
      width: 230,
      render: (_: unknown, row: WatchItem) => (
        <Space size="small">
          <Button size="small" onClick={() => extend(row)}>继续观察</Button>
          <Button size="small" onClick={() => void ignore(row)} disabled={row.status === 'ignored'}>
            忽略
          </Button>
          <Button size="small" danger onClick={() => void remove(row)}>移除</Button>
        </Space>
      )
    }
  ]

  return (
    <Card
      size="small"
      title="观察列表"
      extra={<Button size="small" onClick={() => void load()} loading={loading}>刷新</Button>}
    >
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        暂时无法决定的文件可放在这里观察。本列表只记录路径与提醒时间，<Text strong>不移动、不删除任何文件</Text>。到期会提醒你处理。
      </Text>
      {dueCount > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`有 ${dueCount} 个文件已到观察期，建议处理（继续观察 / 迁移冷藏 / 忽略 / 手动删除）。`}
        />
      )}
      {items.length === 0 ? (
        <Empty description="观察列表为空" />
      ) : (
        <Table size="small" rowKey="id" dataSource={items} columns={cols} pagination={{ pageSize: 12 }} />
      )}
    </Card>
  )
}
