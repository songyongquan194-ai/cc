import { useEffect, useState } from 'react'
import {
  Button, Card, Steps, Typography, Space, Input, Select, Alert, message, Result, Progress
} from 'antd'
import { formatBytes } from './format'

const { Title, Paragraph, Text } = Typography

const PERIODS = [
  { value: 30, label: '30 天' },
  { value: 60, label: '60 天' },
  { value: 90, label: '90 天' },
  { value: -1, label: '永久' }
]

export default function Onboarding({ onDone }: { onDone: (goScan: boolean) => void }): JSX.Element {
  const [step, setStep] = useState(0)
  const [path, setPath] = useState('')
  const [period, setPeriod] = useState(90)
  const [busy, setBusy] = useState(false)
  const [backupSet, setBackupSet] = useState(false)
  const [sys, setSys] = useState<{ free: number; total: number } | null>(null)

  useEffect(() => {
    void window.api.overview.get().then((o) => setSys(o.system))
  }, [])

  const finish = async (): Promise<void> => {
    await window.api.settings.set('onboarding_done', true)
  }

  const saveBackup = async (): Promise<void> => {
    if (!path.trim()) {
      message.warning('请输入备份盘目录，或选择「暂不设置」')
      return
    }
    setBusy(true)
    try {
      const v = await window.api.backup.validate(path.trim())
      if (!v.ok) {
        message.error('校验未通过：' + (v.error ?? '未知原因'))
        return
      }
      const r = await window.api.backup.set(path.trim(), period)
      if (r.ok) {
        setBackupSet(true)
        message.success('备份盘已设置')
        setStep(2)
      } else message.error(r.error ?? '设置失败')
    } finally {
      setBusy(false)
    }
  }

  const lowFree = sys && sys.total > 0 ? sys.free / sys.total < 0.15 : false
  const usedPct = sys && sys.total > 0 ? Math.round(((sys.total - sys.free) / sys.total) * 100) : 0

  return (
    <div style={{ maxWidth: 720, margin: '40px auto' }}>
      <Card>
        <Steps
          current={step}
          size="small"
          style={{ marginBottom: 24 }}
          items={[{ title: '产品原则' }, { title: '备份盘' }, { title: '开始' }]}
        />

        {step === 0 && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Title level={4}>欢迎使用 系统盘安全清理与文件冷藏</Title>
            <Paragraph>
              本工具帮你安全地释放系统盘空间。核心原则：
            </Paragraph>
            <ul>
              <li><Text strong>确定安全的</Text>（系统临时、缓存、回收站等）才自动清理；</li>
              <li><Text strong>不确定的</Text>会解释清楚、分类展示，优先迁移到备份盘<Text strong>冷藏</Text>，可随时恢复；</li>
              <li><Text strong>高风险内容</Text>（个人文档、系统关键文件）默认<Text strong>不处理</Text>。</li>
            </ul>
            <Alert
              type="info"
              showIcon
              message="数据处理说明"
              description="所有扫描与分析均在本机完成，不上传任何文件内容或路径。操作记录仅保存在本地数据库，可随时导出或清空。冷藏文件以原样副本存放在你指定的备份盘，并附带可移植清单（manifest.json）。"
            />
            <div style={{ textAlign: 'right' }}>
              <Button type="primary" onClick={() => setStep(1)}>
                我已了解，下一步
              </Button>
            </div>
          </Space>
        )}

        {step === 1 && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Title level={4}>设置备份盘（可选）</Title>
            <Alert
              type="info"
              showIcon
              message="备份盘用于冷藏迁移的文件，必须是非系统盘（不能是系统盘/启动盘）、非系统目录且可写。可用外接移动硬盘。"
            />
            <Space wrap>
              <Input
                style={{ width: 320 }}
                placeholder="D:\ 或 E:\Backup"
                value={path}
                onChange={(e) => setPath(e.target.value)}
              />
              <Text>冷藏周期：</Text>
              <Select value={period} style={{ width: 110 }} options={PERIODS} onChange={setPeriod} />
            </Space>
            <Text type="secondary">
              暂不设置也可以：你仍能扫描、查看分类并执行安全清理；迁移冷藏功能将在设置备份盘后启用。
            </Text>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Button onClick={() => setStep(0)}>上一步</Button>
              <Space>
                <Button onClick={() => setStep(2)}>暂不设置</Button>
                <Button type="primary" loading={busy} onClick={saveBackup}>
                  校验并保存
                </Button>
              </Space>
            </div>
          </Space>
        )}

        {step === 2 && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Result
              status={lowFree ? 'warning' : 'success'}
              title="准备就绪"
              subTitle={
                backupSet
                  ? '备份盘已设置，安全清理与迁移冷藏均可使用。'
                  : '未设置备份盘：可先进行扫描与安全清理，迁移冷藏稍后在「设置」中启用。'
              }
            />
            {sys && sys.total > 0 && (
              <Card size="small" title="系统盘空间">
                <Space>
                  <Progress
                    type="circle"
                    percent={usedPct}
                    size={80}
                    status={lowFree ? 'exception' : 'normal'}
                  />
                  <Space direction="vertical">
                    <Text>可用 {formatBytes(sys.free)} / 总 {formatBytes(sys.total)}</Text>
                    {lowFree && <Text type="danger">剩余空间不足 15%，建议尽快清理或迁移。</Text>}
                  </Space>
                </Space>
              </Card>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Button onClick={() => setStep(1)}>上一步</Button>
              <Space>
                <Button
                  onClick={async () => {
                    await finish()
                    onDone(false)
                  }}
                >
                  进入首页
                </Button>
                <Button
                  type="primary"
                  onClick={async () => {
                    await finish()
                    onDone(true)
                  }}
                >
                  开始扫描
                </Button>
              </Space>
            </div>
          </Space>
        )}
      </Card>
    </div>
  )
}
