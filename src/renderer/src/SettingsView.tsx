import { useEffect, useState } from 'react'
import { Button, Card, Input, Space, Typography, message, Descriptions, Select, Alert, Switch } from 'antd'
import AISettings from './AISettings'

const { Text } = Typography
const { TextArea } = Input

interface BackupInfo {
  path: string
  cold_root: string
  volume_serial: string | null
  cold_period_days: number
}

const PERIODS = [
  { value: 30, label: '30 天' },
  { value: 60, label: '60 天' },
  { value: 90, label: '90 天' },
  { value: -1, label: '永久' }
]

export default function SettingsView(): JSX.Element {
  const [info, setInfo] = useState<BackupInfo | null>(null)
  const [path, setPath] = useState('')
  const [period, setPeriod] = useState(90)
  const [busy, setBusy] = useState(false)
  const [excluded, setExcluded] = useState('')
  const [exBusy, setExBusy] = useState(false)
  const [tray, setTray] = useState(false)
  const [version, setVersion] = useState('')

  const load = async (): Promise<void> => {
    const i = await window.api.backup.get()
    setInfo(i)
    if (i) {
      setPath(i.path)
      setPeriod(i.cold_period_days)
    }
    const dirs = await window.api.settings.get<string[]>('excluded_dirs', [])
    setExcluded(dirs.join('\n'))
    setTray(await window.api.settings.get<boolean>('minimize_to_tray', false))
    setVersion(await window.api.app.version())
  }

  const toggleTray = async (v: boolean): Promise<void> => {
    setTray(v)
    await window.api.app.setTray(v)
    message.success(v ? '已开启：关闭窗口将最小化到托盘' : '已关闭：关闭窗口即退出')
  }

  const saveExcluded = async (): Promise<void> => {
    setExBusy(true)
    try {
      const dirs = excluded
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      await window.api.settings.set('excluded_dirs', dirs)
      setExcluded(dirs.join('\n'))
      message.success(`已保存，共 ${dirs.length} 个排除目录`)
    } finally {
      setExBusy(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const save = async (): Promise<void> => {
    if (!path.trim()) {
      message.warning('请输入备份盘目录，例如 D:\\ 或 E:\\Backup')
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
        message.success('备份盘已设置')
        await load()
      } else message.error(r.error ?? '设置失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card size="small" title="备份盘设置">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="备份盘用于冷藏迁移的文件。必须是非系统盘（不能是系统盘/启动盘）、非系统目录，且可写。可使用外接移动硬盘。"
        />
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space wrap>
            <Input
              style={{ width: 360 }}
              placeholder="D:\ 或 E:\Backup"
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
            <Text>冷藏周期：</Text>
            <Select value={period} style={{ width: 120 }} options={PERIODS} onChange={setPeriod} />
            <Button type="primary" loading={busy} onClick={save}>
              校验并保存
            </Button>
          </Space>
        </Space>
      </Card>

      {info && (
        <Card size="small" title="当前备份盘">
          <Descriptions column={1} size="small">
            <Descriptions.Item label="备份盘目录">{info.path}</Descriptions.Item>
            <Descriptions.Item label="冷藏区根">{info.cold_root}</Descriptions.Item>
            <Descriptions.Item label="卷序列号">{info.volume_serial ?? '未知'}</Descriptions.Item>
            <Descriptions.Item label="默认冷藏周期">
              {info.cold_period_days <= 0 ? '永久' : `${info.cold_period_days} 天`}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}
      {!info && <Text type="secondary">尚未设置备份盘。未设置前迁移与冷藏功能不可用。</Text>}

      <Card
        size="small"
        title="排除目录"
        extra={
          <Button type="primary" size="small" loading={exBusy} onClick={saveExcluded}>
            保存
          </Button>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="这里列出的目录在扫描时会被完全跳过（不清理、不迁移、不展示）。每行一个目录，例如 C:\\Users\\我\\重要项目。"
        />
        <TextArea
          rows={5}
          value={excluded}
          onChange={(e) => setExcluded(e.target.value)}
          placeholder={'C:\\Users\\你\\重要项目\nC:\\KeepThisFolder'}
          spellCheck={false}
        />
      </Card>

      <AISettings />

      <Card size="small" title="后台与提醒">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="默认关闭窗口即退出，不在后台常驻（轻量化原则）。如希望关闭后保留在系统托盘、便于接收观察列表到期提醒，可开启下方开关。"
        />
        <Space>
          <Switch checked={tray} onChange={(v) => void toggleTray(v)} />
          <Text>最小化到系统托盘（关闭窗口不退出）</Text>
        </Space>
      </Card>

      <Card size="small" title="关于">
        <Descriptions column={1} size="small">
          <Descriptions.Item label="版本">{version || '—'}</Descriptions.Item>
          <Descriptions.Item label="更新方式">
            <Space direction="vertical" size={4}>
              <Text type="secondary">
                本应用不在后台自动更新，也不会主动联网回传任何数据。需要更新时请手动获取新版本安装包。
              </Text>
            </Space>
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </Space>
  )
}
