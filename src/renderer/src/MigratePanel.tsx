import { useState } from 'react'
import {
  Button, Card, Table, Tag, Modal, Space, Statistic, Row, Col, Typography, message, Alert
} from 'antd'
import type { ScanItem } from '@shared/types'
import { formatBytes, RISK_LABEL, RISK_COLOR, catLabel } from './format'

const { Text, Paragraph } = Typography

interface MigrateReport {
  freed_bytes: number
  backup_used_bytes: number
  migrated: number
  source_kept: number
  skipped: number
  failed: number
}

export default function MigratePanel({ scanId }: { scanId: number }): JSX.Element {
  const [items, setItems] = useState<ScanItem[] | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<MigrateReport | null>(null)
  const [noBackup, setNoBackup] = useState(false)

  const loadPreview = async (): Promise<void> => {
    setLoading(true)
    try {
      const info = await window.api.backup.get()
      setNoBackup(!info)
      const list = await window.api.migrate.preview(scanId)
      setItems(list)
      setSelected(list.map((i) => i.path))
      setReport(null)
    } catch (e) {
      message.error('加载可迁移项失败：' + String(e))
    } finally {
      setLoading(false)
    }
  }

  const selectedBytes = (items ?? [])
    .filter((i) => selected.includes(i.path))
    .reduce((s, i) => s + i.size_bytes, 0)

  const openPlan = async (): Promise<void> => {
    const plan = await window.api.migrate.plan(scanId, selected)
    if (!plan.backup_set) {
      message.warning('尚未设置备份盘，请先在「设置」中选择备份盘后再迁移。')
      return
    }
    if (!plan.allowed) {
      Modal.error({
        title: '无法迁移',
        content:
          plan.error_code === 'E_BACKUP_LOW_SPACE'
            ? `备份盘空间不足：迁移后剩余将低于阈值 ${formatBytes(plan.backup_threshold)}。请减少迁移项或更换备份盘。`
            : `迁移计划未通过（${plan.error_code ?? '未知'}）。`
      })
      return
    }
    Modal.confirm({
      title: '确认迁移到冷藏区？',
      width: 520,
      content: (
        <div>
          <Paragraph>将迁移 <Text strong>{selected.length}</Text> 个文件到备份盘冷藏区：</Paragraph>
          <Row gutter={12}>
            <Col span={8}><Statistic title="释放 C 盘" value={formatBytes(plan.c_freed_bytes)} valueStyle={{ color: '#3f8600', fontSize: 18 }} /></Col>
            <Col span={8}><Statistic title="占用备份盘" value={formatBytes(plan.backup_used_bytes)} valueStyle={{ fontSize: 18 }} /></Col>
            <Col span={8}><Statistic title="迁后备份盘剩余" value={formatBytes(plan.backup_free_after)} valueStyle={{ fontSize: 18 }} /></Col>
          </Row>
          {plan.warnings.map((w, i) => (
            <Alert key={i} type="warning" showIcon style={{ marginTop: 8 }} message={w} />
          ))}
          <Paragraph type="secondary" style={{ marginTop: 8 }}>
            迁移采用「复制→校验→删除源」，校验通过前不会删除原文件。
          </Paragraph>
        </div>
      ),
      okText: '开始迁移',
      cancelText: '取消',
      onOk: runMigrate
    })
  }

  const runMigrate = async (): Promise<void> => {
    setRunning(true)
    try {
      const r = await window.api.migrate.run(scanId, selected)
      setReport(r)
      setItems(null)
      message.success(`迁移完成，释放 ${formatBytes(r.freed_bytes)}`)
    } catch (e) {
      message.error('迁移失败：' + String(e))
    } finally {
      setRunning(false)
    }
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
    { title: '分类', dataIndex: 'category', width: 130, render: (c: string) => catLabel(c) }
  ]

  return (
    <Card size="small" title="迁移到冷藏区">
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Button type="primary" loading={loading} onClick={loadPreview}>
          查看可迁移项
        </Button>
        {noBackup && items && (
          <Alert
            type="info"
            showIcon
            message="尚未设置备份盘，迁移不可执行。可先在「设置」中选择一个非系统盘作为备份盘。"
          />
        )}
        <Text type="secondary">大文件与开发缓存等「建议迁移」项进入此处；高风险内容不会迁移。</Text>

        {items && items.length > 0 && (
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
                已选 {selected.length} / {items.length} 项，合计 {formatBytes(selectedBytes)}
              </Text>
              <Button
                type="primary"
                loading={running}
                disabled={selected.length === 0 || noBackup}
                onClick={openPlan}
              >
                查看迁移计划并迁移
              </Button>
            </Space>
          </>
        )}
        {items && items.length === 0 && <Text type="secondary">本次扫描没有建议迁移的项。</Text>}

        {report && (
          <Card size="small" type="inner" title="迁移报告">
            <Row gutter={16}>
              <Col span={5}><Statistic title="已释放 C 盘" value={formatBytes(report.freed_bytes)} valueStyle={{ color: '#3f8600' }} /></Col>
              <Col span={4}><Statistic title="迁移成功" value={report.migrated} /></Col>
              <Col span={5}><Statistic title="源保留" value={report.source_kept} valueStyle={report.source_kept ? { color: '#d48806' } : undefined} /></Col>
              <Col span={5}><Statistic title="跳过" value={report.skipped} /></Col>
              <Col span={5}><Statistic title="失败" value={report.failed} valueStyle={report.failed ? { color: '#cf1322' } : undefined} /></Col>
            </Row>
            {report.skipped > 0 && (
              <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
                跳过项多为：源文件已被自动清理、正在被占用/写入，或处于排除目录——均属正常，源文件原样保留，不影响数据安全。
              </Text>
            )}
          </Card>
        )}
      </Space>
    </Card>
  )
}
