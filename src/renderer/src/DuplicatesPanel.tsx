import { useState } from 'react'
import { Button, Card, Table, Tag, Typography, Space, message, Tooltip } from 'antd'
import { formatBytes } from './format'
import WhyButton from './WhyButton'

const { Text, Paragraph } = Typography

type DuplicateResult = Awaited<ReturnType<Window['api']['dup']['groups']>>
type DupGroup = DuplicateResult['groups'][number]
type DupFile = DupGroup['files'][number]

export default function DuplicatesPanel({ scanId }: { scanId: number }): JSX.Element {
  const [res, setRes] = useState<DuplicateResult | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      setRes(await window.api.dup.groups(scanId))
    } catch (e) {
      message.error('分析重复文件失败：' + String(e))
    } finally {
      setLoading(false)
    }
  }

  const addToWatch = async (f: DupFile): Promise<void> => {
    const r = await window.api.watch.add({
      path: f.path,
      size_bytes: f.size_bytes,
      category: f.category,
      reason: '重复文件候选',
      periodDays: 30
    })
    if (r.ok) message.success('已加入观察列表')
  }

  const expanded = (group: DupGroup): JSX.Element => {
    const cols = [
      {
        title: '文件',
        dataIndex: 'path',
        ellipsis: true,
        render: (p: string) =>
          p === group.suggested_keep ? (
            <Space size={4}>
              <Tag color="green">建议保留</Tag>
              <Text>{p}</Text>
            </Space>
          ) : (
            <Text type="secondary">{p}</Text>
          )
      },
      {
        title: '修改时间',
        dataIndex: 'mtime',
        width: 160,
        render: (t: string | null) => (t ? new Date(t).toLocaleString() : '—')
      },
      {
        title: '操作',
        width: 200,
        render: (_: unknown, f: DupFile) => (
          <Space size={0}>
            <WhyButton
              input={{
                path: f.path,
                ext: (f.path.match(/\.[^.\\/]+$/)?.[0] ?? '').toLowerCase(),
                size_bytes: f.size_bytes,
                mtime: f.mtime,
                atime: f.atime,
                category: f.category ?? 'uncategorized',
                risk_level: 'low',
                default_action: 'none',
                rule_explain: '同名同大小的重复文件候选（未做内容哈希确认）。'
              }}
            />
            {f.path === group.suggested_keep ? (
              <Text type="secondary">建议保留</Text>
            ) : (
              <Button size="small" type="link" onClick={() => void addToWatch(f)}>
                加入观察列表
              </Button>
            )}
          </Space>
        )
      }
    ]
    return (
      <Space direction="vertical" style={{ width: '100%' }}>
        <Paragraph type="secondary" style={{ marginBottom: 4 }}>
          {group.reason}
        </Paragraph>
        <Table size="small" rowKey="path" dataSource={group.files} columns={cols} pagination={false} />
      </Space>
    )
  }

  const cols = [
    {
      title: '文件名',
      render: (_: unknown, g: DupGroup) => {
        const name = g.suggested_keep.split('\\').pop()
        return <Text>{name}</Text>
      }
    },
    { title: '份数', dataIndex: 'count', width: 80 },
    {
      title: '单份大小',
      dataIndex: 'size_bytes',
      width: 110,
      render: (b: number) => formatBytes(b)
    },
    {
      title: '可回收',
      width: 110,
      render: (_: unknown, g: DupGroup) => (
        <Text type="warning">{formatBytes(g.size_bytes * (g.count - 1))}</Text>
      )
    }
  ]

  return (
    <Card
      size="small"
      title={
        <Space>
          重复文件候选
          <Tooltip title="仅展示同名同大小候选，默认不删除、不做全盘哈希。可加入观察列表或手动迁移冷藏。">
            <Text type="secondary" style={{ fontSize: 12 }}>（只展示，不自动删除）</Text>
          </Tooltip>
        </Space>
      }
      extra={
        <Button size="small" loading={loading} onClick={() => void load()}>
          {res ? '重新分析' : '分析重复文件'}
        </Button>
      }
    >
      {!res ? (
        <Text type="secondary">点击「分析重复文件」在本次扫描结果中查找同名同大小候选（默认 ≥1MB）。</Text>
      ) : res.group_count === 0 ? (
        <Text type="secondary">未发现重复候选。</Text>
      ) : (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text>
            发现 <Text strong>{res.group_count}</Text> 组候选，预计可回收{' '}
            <Text strong type="warning">{formatBytes(res.total_reclaimable)}</Text>
            。删除需你手动确认（本工具不自动删除重复文件）。
          </Text>
          <Table
            size="small"
            rowKey="key"
            dataSource={res.groups}
            columns={cols}
            expandable={{ expandedRowRender: expanded }}
            pagination={{ pageSize: 8 }}
          />
        </Space>
      )}
    </Card>
  )
}
