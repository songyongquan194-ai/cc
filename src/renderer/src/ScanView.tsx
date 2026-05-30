import { useState } from 'react'
import {
  Button, Space, Card, Statistic, Row, Col, Table, Tag, Progress, Typography, message, Modal, Tooltip
} from 'antd'
import type { ScanItem, ScanType, AIIdentifyResult } from '@shared/types'
import {
  formatBytes, RISK_LABEL, RISK_COLOR, ACTION_LABEL, catLabel
} from './format'
import { useScanStore, type SummaryRow } from './store/scanStore'
import CleanPanel from './CleanPanel'
import MigratePanel from './MigratePanel'
import DuplicatesPanel from './DuplicatesPanel'
import WhyButton from './WhyButton'

const { Text } = Typography

export default function ScanView(): JSX.Element {
  // 扫描会话状态来自常驻 store：切换界面不会中断扫描，回到本页仍能看到进度/结果。
  const scanning = useScanStore((s) => s.scanning)
  const progress = useScanStore((s) => s.progress)
  const scanId = useScanStore((s) => s.scanId)
  const summary = useScanStore((s) => s.summary)
  const result = useScanStore((s) => s.result)
  const cancelScan = useScanStore((s) => s.cancel)
  const [detail, setDetail] = useState<{ category: string; items: ScanItem[] } | null>(null)
  const [detailPage, setDetailPage] = useState(1)
  const [idMap, setIdMap] = useState<Record<string, AIIdentifyResult>>({})
  const [identifying, setIdentifying] = useState(false)

  const startScan = (type: ScanType): void => {
    useScanStore
      .getState()
      .startScan(type)
      .catch((e) => message.error('扫描失败：' + String(e)))
  }

  // 中断扫描需显式确认，避免误触；切换界面本身不会中断扫描。
  const confirmCancel = (): void => {
    Modal.confirm({
      title: '停止本次扫描？',
      content: '扫描会立即停止，已扫描到的结果会保留。可随时重新开始。',
      okText: '停止扫描',
      okButtonProps: { danger: true },
      cancelText: '继续扫描',
      onOk: cancelScan
    })
  }

  const openDetail = async (category: string): Promise<void> => {
    if (scanId == null) return
    const items = await window.api.scan.items(scanId, category)
    setDetail({ category, items })
    setDetailPage(1)
    setIdMap({})
  }

  // 让本机模型识别"当前页这 12 个文件大概是什么"。安全/小文本会读片段，敏感/高风险只看元数据。
  const identifyPage = async (): Promise<void> => {
    if (!detail) return
    const pageItems = detail.items.slice((detailPage - 1) * 12, detailPage * 12)
    if (!pageItems.length) return
    setIdentifying(true)
    try {
      const res = await window.api.ai.identify(
        pageItems.map((i) => ({
          path: i.path,
          ext: i.ext,
          size_bytes: i.size_bytes,
          mtime: i.mtime,
          category: i.category,
          risk_level: i.risk_level
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

  const summaryCols = [
    { title: '分类', dataIndex: 'category', render: (c: string) => catLabel(c) },
    {
      title: '风险',
      dataIndex: 'risk_level',
      render: (r: string) => <Tag color={RISK_COLOR[r]}>{RISK_LABEL[r]}</Tag>
    },
    { title: '项数', dataIndex: 'count' },
    {
      title: '占用空间',
      dataIndex: 'bytes',
      render: (b: number) => formatBytes(b),
      sorter: (a: SummaryRow, b: SummaryRow) => a.bytes - b.bytes,
      defaultSortOrder: 'descend' as const
    },
    {
      title: '操作',
      render: (_: unknown, row: SummaryRow) => (
        <Button size="small" onClick={() => openDetail(row.category)}>
          查看文件
        </Button>
      )
    }
  ]

  const detailCols = [
    { title: '路径', dataIndex: 'path', ellipsis: true },
    { title: '大小', dataIndex: 'size_bytes', render: (b: number) => formatBytes(b), width: 100 },
    {
      title: '风险',
      dataIndex: 'risk_level',
      width: 90,
      render: (r: string) => <Tag color={RISK_COLOR[r]}>{RISK_LABEL[r]}</Tag>
    },
    {
      title: '建议动作',
      dataIndex: 'default_action',
      width: 100,
      render: (a: string) => ACTION_LABEL[a] ?? a
    },
    {
      title: 'AI 识别',
      width: 240,
      render: (_: unknown, row: ScanItem) => {
        const r = idMap[row.path]
        if (!r) return <Text type="secondary">—</Text>
        const conf = r.confidence === 'high' ? '高' : r.confidence === 'medium' ? '中' : '低'
        const color = r.confidence === 'high' ? 'green' : r.confidence === 'medium' ? 'gold' : 'default'
        return (
          <Tooltip title={r.used_content ? '已结合内容片段判断' : '仅依据元数据判断'}>
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
    {
      title: '操作',
      width: 180,
      render: (_: unknown, row: ScanItem) => (
        <Space size={0}>
          <WhyButton
            input={{
              path: row.path,
              ext: row.ext,
              size_bytes: row.size_bytes,
              mtime: row.mtime,
              atime: row.atime,
              category: row.category,
              risk_level: row.risk_level,
              default_action: row.default_action,
              rule_explain: row.explain
            }}
          />
          <Button
            size="small"
            type="link"
            onClick={async () => {
              const r = await window.api.watch.add({
                path: row.path,
                size_bytes: row.size_bytes,
                category: row.category,
                reason: '扫描中暂不决定',
                periodDays: 30
              })
              if (r.ok) message.success('已加入观察列表')
            }}
          >
            加入观察
          </Button>
        </Space>
      )
    }
  ]

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card size="small">
        <Space>
          <Button type="primary" loading={scanning} onClick={() => startScan('quick')}>
            快速扫描
          </Button>
          <Button loading={scanning} onClick={() => startScan('deep')}>
            深度扫描
          </Button>
          {scanning && <Button danger onClick={confirmCancel}>停止扫描</Button>}
        </Space>
      </Card>

      {(scanning || progress) && (
        <Card size="small" title="扫描进度">
          <Progress percent={scanning ? undefined : 100} status={scanning ? 'active' : 'success'} />
          <Space direction="vertical" style={{ marginTop: 8 }}>
            <Text type="secondary" ellipsis style={{ maxWidth: 760 }}>
              正在扫描：{progress?.current_dir || '—'}
            </Text>
            <Space size="large" wrap>
              <span>已扫描：{progress?.files_scanned?.toLocaleString() ?? 0} 项</span>
              <span>可安全清理：{formatBytes(progress?.safe_bytes ?? 0)}</span>
              <span>建议迁移：{formatBytes(progress?.migratable_bytes ?? 0)}</span>
              <span>高风险：{formatBytes(progress?.highrisk_bytes ?? 0)}</span>
              <span>耗时：{((progress?.elapsed_ms ?? 0) / 1000).toFixed(1)}s</span>
            </Space>
            {scanning && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                扫描在后台继续，可随意切换到其它页面；只有点「停止扫描」才会中断。
              </Text>
            )}
          </Space>
        </Card>
      )}

      {result && (
        <Card size="small" title={result.cancelled ? '扫描已取消（部分结果）' : '扫描结果'}>
          <Row gutter={16}>
            <Col span={6}>
              <Statistic title="可安全清理" value={formatBytes(result.safe_bytes)} valueStyle={{ color: '#3f8600' }} />
            </Col>
            <Col span={6}>
              <Statistic title="建议迁移冷藏" value={formatBytes(result.migratable_bytes)} valueStyle={{ color: '#d48806' }} />
            </Col>
            <Col span={6}>
              <Statistic title="高风险（仅展示）" value={formatBytes(result.highrisk_bytes)} valueStyle={{ color: '#cf1322' }} />
            </Col>
            <Col span={6}>
              <Statistic title="扫描项数" value={result.total_files} />
            </Col>
          </Row>
          {result.dir_error_count > 0 && (
            <Text type="warning">
              {result.dir_error_count} 个目录因无权限或被占用已跳过。
            </Text>
          )}
        </Card>
      )}

      {summary.length > 0 && (
        <Card size="small" title="按分类查看">
          <Table
            size="small"
            rowKey={(r) => r.category + r.risk_level}
            dataSource={summary}
            columns={summaryCols}
            pagination={false}
          />
        </Card>
      )}

      {scanId != null && result && !result.cancelled && (
        <>
          <CleanPanel scanId={scanId} />
          <MigratePanel scanId={scanId} />
          <DuplicatesPanel scanId={scanId} />
        </>
      )}

      <Modal
        open={!!detail}
        title={detail ? catLabel(detail.category) + ' — 文件列表（前 500 项）' : ''}
        footer={null}
        width={1120}
        onCancel={() => setDetail(null)}
      >
        <Space style={{ marginBottom: 8 }} align="start">
          <Button size="small" loading={identifying} onClick={identifyPage} disabled={!detail?.items.length}>
            AI 识别本页
          </Button>
          <Text type="secondary" style={{ fontSize: 12 }}>
            让本机模型判断「这大概是什么」。仅对安全的小文本文件读取开头片段，敏感/高风险文件只看元数据；全程本地、不出网。
          </Text>
        </Space>
        <Table
          size="small"
          rowKey="path"
          dataSource={detail?.items ?? []}
          columns={detailCols}
          pagination={{ pageSize: 12, current: detailPage, onChange: setDetailPage }}
          scroll={{ y: 420 }}
        />
      </Modal>
    </Space>
  )
}
