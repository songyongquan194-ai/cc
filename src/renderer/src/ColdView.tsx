import { useEffect, useMemo, useState } from 'react'
import {
  Button, Card, Table, Space, Typography, message, Modal, Select, Tag, Empty, Input, Tooltip
} from 'antd'
import type { ColdItem, AIIdentifyResult, RiskLevel } from '@shared/types'
import { formatBytes, catLabel } from './format'
import RestoreModal from './RestoreModal'

const { Text } = Typography

const extOf = (p: string): string => {
  const b = p.split('\\').pop() ?? ''
  const i = b.lastIndexOf('.')
  return i >= 0 ? b.slice(i).toLowerCase() : ''
}

const PERIODS = [
  { value: 30, label: '30 天' },
  { value: 60, label: '60 天' },
  { value: 90, label: '90 天' },
  { value: -1, label: '永久' }
]

export default function ColdView(): JSX.Element {
  const [items, setItems] = useState<ColdItem[]>([])
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState<ColdItem | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [idMap, setIdMap] = useState<Record<string, AIIdentifyResult>>({})
  const [identifying, setIdentifying] = useState(false)

  // 按原路径/备份路径/分类做不区分大小写的子串过滤。
  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase()
    if (!kw) return items
    return items.filter(
      (i) =>
        i.original_path.toLowerCase().includes(kw) ||
        (i.cold_path ?? '').toLowerCase().includes(kw) ||
        (i.category ?? '').toLowerCase().includes(kw)
    )
  }, [items, search])

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      setItems(await window.api.cold.list())
    } catch (e) {
      message.error('加载冷藏区失败：' + String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  // 识别当前页冷藏项「大概是什么」。原文件已迁走，故从备份盘 cold_path 读取内容片段。
  const identifyPage = async (): Promise<void> => {
    const pageItems = filtered.slice((page - 1) * 12, page * 12)
    if (!pageItems.length) return
    setIdentifying(true)
    try {
      const res = await window.api.ai.identify(
        pageItems.map((c) => ({
          path: c.original_path,
          ext: extOf(c.original_path),
          size_bytes: c.size_bytes,
          mtime: c.mtime,
          category: c.category ?? 'uncategorized',
          risk_level: (c.risk_level ?? 'low') as RiskLevel,
          read_path: c.cold_path
        }))
      )
      setIdMap((prev) => {
        const next = { ...prev }
        res.forEach((r) => (next[r.path] = r))
        return next
      })
    } catch (e) {
      message.error('AI 识别失败：' + String(e))
    } finally {
      setIdentifying(false)
    }
  }

  const extend = (row: ColdItem): void => {
    let period = 90
    Modal.confirm({
      title: '延长冷藏周期',
      content: (
        <Space direction="vertical">
          <Text>自迁入时间重新计算到期日：</Text>
          <Select
            defaultValue={90}
            style={{ width: 160 }}
            options={PERIODS}
            onChange={(v) => (period = v)}
          />
        </Space>
      ),
      onOk: async () => {
        const r = await window.api.cold.extend(row.id, period)
        if (r.ok) {
          message.success('已更新冷藏周期')
          void load()
        } else message.error(r.error ?? '更新失败')
      }
    })
  }

  const remove = (row: ColdItem): void => {
    Modal.confirm({
      title: '永久删除冷藏文件？',
      okText: '永久删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      content: (
        <Text type="danger">
          将从备份盘永久删除「{row.original_path}」（{formatBytes(row.size_bytes)}），此操作不可恢复。
        </Text>
      ),
      onOk: async () => {
        const r = await window.api.cold.delete(row.id)
        if (r.ok) {
          message.success('已永久删除')
          void load()
        } else message.error(r.error ?? '删除失败')
      }
    })
  }

  const cols = [
    {
      title: '原路径',
      dataIndex: 'original_path',
      ellipsis: true,
      width: 320,
      render: (p: string, row: ColdItem) => (
        <Tooltip
          title={
            <div style={{ wordBreak: 'break-all' }}>
              <div>原路径：{p}</div>
              <div style={{ marginTop: 4, opacity: 0.85 }}>备份位置：{row.cold_path}</div>
            </div>
          }
        >
          <Text copyable={{ text: p }} style={{ maxWidth: '100%' }}>
            {p}
          </Text>
        </Tooltip>
      )
    },
    { title: '分类', dataIndex: 'category', width: 120, render: (c: string) => catLabel(c) },
    {
      title: 'AI 识别',
      width: 230,
      render: (_: unknown, row: ColdItem) => {
        const r = idMap[row.original_path]
        if (!r) return <Text type="secondary">—</Text>
        const conf = r.confidence === 'high' ? '高' : r.confidence === 'medium' ? '中' : '低'
        const color = r.confidence === 'high' ? 'green' : r.confidence === 'medium' ? 'gold' : 'default'
        return (
          <Tooltip title={r.used_content ? '已结合备份副本内容判断' : '仅依据元数据判断'}>
            <Space size={4} align="start">
              <Tag color={color} style={{ marginInlineEnd: 0 }}>{conf}</Tag>
              <Text style={{ fontSize: 12 }}>
                {r.description}
                {r.used_content && <Text type="secondary"> ·读内容</Text>}
              </Text>
            </Space>
          </Tooltip>
        )
      }
    },
    { title: '大小', dataIndex: 'size_bytes', width: 100, render: (b: number) => formatBytes(b) },
    {
      title: '迁入时间',
      dataIndex: 'migrated_at',
      width: 160,
      render: (t: string) => new Date(t).toLocaleString()
    },
    {
      title: '到期',
      dataIndex: 'expires_at',
      width: 130,
      render: (t: string | null) =>
        t ? new Date(t).toLocaleDateString() : <Tag color="blue">永久</Tag>
    },
    {
      title: '操作',
      width: 230,
      render: (_: unknown, row: ColdItem) => (
        <Space size="small">
          <Button size="small" type="primary" ghost onClick={() => setRestoring(row)}>恢复</Button>
          <Button size="small" onClick={() => extend(row)}>延长</Button>
          <Button size="small" danger onClick={() => remove(row)}>删除</Button>
        </Space>
      )
    }
  ]

  return (
    <Card
      size="small"
      title="冷藏区"
      extra={<Button size="small" onClick={() => void load()} loading={loading}>刷新</Button>}
    >
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        已迁移到备份盘的文件。可随时恢复到原位置；到期仅提醒、不自动删除。
        鼠标悬停原路径可看完整地址，点击右侧图标复制。
      </Text>
      {items.length === 0 ? (
        <Empty description="冷藏区暂无文件" />
      ) : (
        <>
          <Space style={{ marginBottom: 12 }} wrap>
            <Input.Search
              allowClear
              placeholder="搜索原路径 / 备份位置 / 分类"
              style={{ width: 360 }}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
            <Button size="small" loading={identifying} onClick={identifyPage} disabled={!filtered.length}>
              AI 识别本页
            </Button>
            <Text type="secondary">
              共 {items.length} 项{search.trim() ? `，匹配 ${filtered.length} 项` : ''}
            </Text>
          </Space>
          <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
            「AI 识别」让本机模型判断这大概是什么；安全的小文本会读取备份副本开头片段，敏感/高风险只看元数据，全程本地不出网。
          </Text>
          <Table
            size="small"
            rowKey="id"
            dataSource={filtered}
            columns={cols}
            pagination={{ pageSize: 12, current: page, onChange: setPage }}
            scroll={{ x: 1290 }}
          />
        </>
      )}
      {restoring && (
        <RestoreModal
          item={restoring}
          onClose={() => setRestoring(null)}
          onDone={() => {
            setRestoring(null)
            void load()
          }}
        />
      )}
    </Card>
  )
}
