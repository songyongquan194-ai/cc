import { useEffect, useRef, useState } from 'react'
import {
  Button, Card, Table, Tag, Modal, Space, Statistic, Row, Col, Typography, Progress, message
} from 'antd'
import type { ScanItem } from '@shared/types'
import { formatBytes, RISK_LABEL, RISK_COLOR, catLabel } from './format'

const { Text, Paragraph } = Typography

interface CleanReport {
  freed_bytes: number
  cleaned: number
  skipped: number
  failed: number
  details: { path: string; status: string; error_detail?: string }[]
}

interface CleanProgress {
  processed: number
  total: number
  freed_bytes: number
  cleaned: number
  skipped: number
  failed: number
}

export default function CleanPanel({ scanId }: { scanId: number }): JSX.Element {
  const [items, setItems] = useState<ScanItem[] | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<CleanReport | null>(null)
  const [progress, setProgress] = useState<CleanProgress | null>(null)
  const runningRef = useRef(false)

  // 订阅清理进度：主进程每 ~150ms 聚合推送一次，避免上万条 IPC 刷爆渲染层。
  useEffect(() => {
    const off = window.api.clean.onProgress((p) => {
      if (runningRef.current) setProgress(p)
    })
    return () => {
      off()
    }
  }, [])

  const loadPreview = async (): Promise<void> => {
    setLoading(true)
    try {
      const list = await window.api.clean.preview(scanId)
      setItems(list)
      setSelected(list.map((i) => i.path))
      setReport(null)
    } catch (e) {
      message.error('加载可清理项失败：' + String(e))
    } finally {
      setLoading(false)
    }
  }

  const selectedBytes = (items ?? [])
    .filter((i) => selected.includes(i.path))
    .reduce((s, i) => s + i.size_bytes, 0)

  const confirmAndRun = (): void => {
    Modal.confirm({
      title: '确认清理选中项？',
      content: (
        <Paragraph>
          将永久删除 <Text strong>{selected.length}</Text> 个文件，
          预计释放 <Text strong>{formatBytes(selectedBytes)}</Text>。
          <br />
          仅删除已确认安全的项；占用中或受保护的文件会自动跳过。
        </Paragraph>
      ),
      okText: '开始清理',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: runClean
    })
  }

  const runClean = async (): Promise<void> => {
    runningRef.current = true
    setRunning(true)
    setProgress({ processed: 0, total: selected.length, freed_bytes: 0, cleaned: 0, skipped: 0, failed: 0 })
    try {
      const r = await window.api.clean.run({ scanId, paths: selected })
      setReport(r)
      setItems(null)
      message.success(`清理完成，释放 ${formatBytes(r.freed_bytes)}`)
    } catch (e) {
      message.error('清理失败：' + String(e))
    } finally {
      runningRef.current = false
      setRunning(false)
      setProgress(null)
    }
  }

  const emptyBin = async (): Promise<void> => {
    const r = await window.api.clean.emptyRecycleBin()
    if (r.ok) message.success('回收站已清空')
    else message.error('清空回收站失败：' + (r.error ?? '未知错误'))
  }

  const cols = [
    { title: '路径', dataIndex: 'path', ellipsis: true },
    { title: '大小', dataIndex: 'size_bytes', width: 100, render: (b: number) => formatBytes(b) },
    {
      title: '风险',
      dataIndex: 'risk_level',
      width: 80,
      render: (r: string) => <Tag color={RISK_COLOR[r]}>{RISK_LABEL[r]}</Tag>
    },
    { title: '分类', dataIndex: 'category', width: 140, render: (c: string) => catLabel(c) }
  ]

  return (
    <Card size="small" title="一键安全清理">
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Space>
          <Button type="primary" loading={loading} onClick={loadPreview}>
            查看可清理项
          </Button>
          <Button onClick={emptyBin}>清空回收站</Button>
        </Space>
        <Text type="secondary">
          仅安全（safe/low）且建议清理的项进入此处；高风险与受保护内容不会出现。
        </Text>

        {items && (
          <>
            <Table
              size="small"
              rowKey="path"
              dataSource={items}
              columns={cols}
              pagination={{ pageSize: 10 }}
              scroll={{ y: 360 }}
              rowSelection={{
                selectedRowKeys: selected,
                onChange: (keys) => setSelected(keys as string[])
              }}
            />
            <Space>
              <Text>
                已选 {selected.length} / {items.length} 项，预计释放 {formatBytes(selectedBytes)}
              </Text>
              <Button
                type="primary"
                danger
                loading={running}
                disabled={selected.length === 0}
                onClick={confirmAndRun}
              >
                清理选中项
              </Button>
            </Space>
          </>
        )}

        {running && progress && (
          <Card size="small" type="inner" title="正在清理…">
            <Progress
              percent={progress.total ? Math.round((progress.processed / progress.total) * 100) : 0}
              status="active"
            />
            <Text type="secondary">
              已处理 {progress.processed} / {progress.total} 项，已释放{' '}
              {formatBytes(progress.freed_bytes)}
              （成功 {progress.cleaned}、跳过 {progress.skipped}、失败 {progress.failed}）
            </Text>
          </Card>
        )}

        {report && !running && (
          <Card size="small" type="inner" title="清理报告">
            <Row gutter={16}>
              <Col span={6}>
                <Statistic title="已释放" value={formatBytes(report.freed_bytes)} valueStyle={{ color: '#3f8600' }} />
              </Col>
              <Col span={6}><Statistic title="成功" value={report.cleaned} /></Col>
              <Col span={6}><Statistic title="跳过" value={report.skipped} /></Col>
              <Col span={6}>
                <Statistic title="失败" value={report.failed} valueStyle={report.failed ? { color: '#cf1322' } : undefined} />
              </Col>
            </Row>
          </Card>
        )}
      </Space>
    </Card>
  )
}
