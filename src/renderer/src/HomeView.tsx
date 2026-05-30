import { useEffect, useState } from 'react'
import { Card, Col, Row, Statistic, Progress, Space, Typography, Tag, Button, Empty, message } from 'antd'
import { formatBytes } from './format'
import { OP_LABEL, opStatusTag } from './opMeta'

const { Text } = Typography

type OverviewData = Awaited<ReturnType<Window['api']['overview']['get']>>

export default function HomeView({ onGoScan }: { onGoScan?: () => void }): JSX.Element {
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      setData(await window.api.overview.get())
    } catch (e) {
      message.error('加载概览失败：' + String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const sys = data?.system
  const usedPct = sys && sys.total > 0 ? Math.round(((sys.total - sys.free) / sys.total) * 100) : 0
  const lowFree = sys && sys.total > 0 ? sys.free / sys.total < 0.15 : false

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card
        size="small"
        title="C 盘空间"
        loading={loading}
        extra={<Button size="small" onClick={() => void load()}>刷新</Button>}
      >
        {sys && sys.total > 0 ? (
          <Row gutter={24} align="middle">
            <Col flex="160px">
              <Progress
                type="dashboard"
                percent={usedPct}
                size={120}
                status={lowFree ? 'exception' : 'normal'}
              />
            </Col>
            <Col flex="auto">
              <Space direction="vertical">
                <Text>
                  已用 <Text strong>{formatBytes(sys.total - sys.free)}</Text> / 总容量{' '}
                  {formatBytes(sys.total)}
                </Text>
                <Text type={lowFree ? 'danger' : 'secondary'}>
                  可用 {formatBytes(sys.free)}
                  {lowFree && '（剩余不足 15%，建议清理或迁移）'}
                </Text>
              </Space>
            </Col>
          </Row>
        ) : (
          <Text type="secondary">无法读取 C 盘空间信息。</Text>
        )}
      </Card>

      <Row gutter={16}>
        <Col span={8}>
          <Card size="small" loading={loading}>
            <Statistic
              title="最近扫描 · 可安全清理"
              value={data?.scan ? formatBytes(data.scan.safe_bytes) : '—'}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {data?.scan
                ? `共 ${data.scan.total_files} 个文件 · ${data.scan.finished_at ? new Date(data.scan.finished_at).toLocaleString() : ''}`
                : '尚未扫描'}
            </Text>
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" loading={loading}>
            <Statistic
              title="可迁移冷藏"
              value={data?.scan ? formatBytes(data.scan.migratable_bytes) : '—'}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              高风险 {data?.scan ? formatBytes(data.scan.highrisk_bytes) : '—'}（默认不处理）
            </Text>
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" loading={loading}>
            <Statistic title="冷藏区占用" value={formatBytes(data?.cold.bytes ?? 0)} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {data?.cold.count ?? 0} 个文件已迁移到备份盘
            </Text>
          </Card>
        </Col>
      </Row>

      <Card size="small" title="备份盘状态" loading={loading}>
        {data?.backup.set ? (
          <Space size="large" wrap>
            {data.backup.online ? (
              <Tag color="green">在线</Tag>
            ) : (
              <Tag color="orange">离线 / 未连接</Tag>
            )}
            <Text>{data.backup.path}</Text>
            <Text type="secondary">
              默认冷藏周期：{data.backup.cold_period_days <= 0 ? '永久' : `${data.backup.cold_period_days} 天`}
            </Text>
          </Space>
        ) : (
          <Space direction="vertical">
            <Text type="warning">尚未设置备份盘。可继续扫描与安全清理，迁移冷藏功能需先设置备份盘。</Text>
          </Space>
        )}
      </Card>

      <Card
        size="small"
        title="最近操作"
        extra={onGoScan && <Button type="primary" size="small" onClick={onGoScan}>开始扫描</Button>}
        loading={loading}
      >
        {data && data.recent.length > 0 ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            {data.recent.map((op) => (
              <Row key={op.id} gutter={8} align="middle" style={{ width: '100%' }}>
                <Col flex="92px">
                  <Tag>{OP_LABEL[op.op_type] ?? op.op_type}</Tag>
                </Col>
                <Col flex="auto">
                  <Text ellipsis style={{ maxWidth: 460 }}>
                    {op.path ?? (op.action ?? '—')}
                  </Text>
                </Col>
                <Col flex="80px">{opStatusTag(op.status)}</Col>
                <Col flex="150px">
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {new Date(op.ts).toLocaleString()}
                  </Text>
                </Col>
              </Row>
            ))}
          </Space>
        ) : (
          <Empty description="暂无操作记录" />
        )}
      </Card>
    </Space>
  )
}
