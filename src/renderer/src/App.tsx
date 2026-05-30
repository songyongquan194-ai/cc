import { useEffect, useState } from 'react'
import { Layout, Typography, Tag, Menu, Spin } from 'antd'
import HomeView from './HomeView'
import ScanView from './ScanView'
import ColdView from './ColdView'
import WatchView from './WatchView'
import RecordsView from './RecordsView'
import SettingsView from './SettingsView'
import Onboarding from './Onboarding'

const { Header, Content } = Layout
const { Title, Text } = Typography

type View = 'home' | 'scan' | 'cold' | 'watch' | 'records' | 'settings'

const MENU = [
  { key: 'home', label: '首页' },
  { key: 'scan', label: '扫描与清理' },
  { key: 'cold', label: '冷藏区' },
  { key: 'watch', label: '观察列表' },
  { key: 'records', label: '操作记录' },
  { key: 'settings', label: '设置' }
]

export default function App(): JSX.Element {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [view, setView] = useState<View>('home')
  const [onboarded, setOnboarded] = useState<boolean | null>(null)

  useEffect(() => {
    window.api
      ?.ping()
      .then(() => setConnected(true))
      .catch(() => setConnected(false))
    window.api?.settings
      .get<boolean>('onboarding_done', false)
      .then((v) => setOnboarded(!!v))
      .catch(() => setOnboarded(true))
  }, [])

  if (onboarded === null) {
    return (
      <Layout style={{ minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
      </Layout>
    )
  }

  if (!onboarded) {
    return (
      <Layout style={{ minHeight: '100vh' }}>
        <Content>
          <Onboarding
            onDone={(goScan) => {
              setOnboarded(true)
              setView(goScan ? 'scan' : 'home')
            }}
          />
        </Content>
      </Layout>
    )
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ background: '#fff', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingInline: 24 }}>
        <Title level={4} style={{ margin: 0, whiteSpace: 'nowrap' }}>
          C 盘安全清理与文件冷藏
        </Title>
        <Menu
          mode="horizontal"
          selectedKeys={[view]}
          items={MENU}
          onClick={(e) => setView(e.key as View)}
          style={{ flex: 1, justifyContent: 'center', borderBottom: 'none' }}
        />
        <Text type="secondary">
          {connected === null ? '连接中…' : connected ? <Tag color="green">已就绪</Tag> : <Tag color="red">IPC 未连接</Tag>}
        </Text>
      </Header>
      <Content style={{ padding: 24, maxWidth: 1040, margin: '0 auto', width: '100%' }}>
        {view === 'home' && <HomeView onGoScan={() => setView('scan')} />}
        {view === 'scan' && (
          <>
            <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
              安全清理 · 不确定先冷藏 · 高风险不动。深度扫描会识别大文件并建议迁移。
            </Text>
            <ScanView />
          </>
        )}
        {view === 'cold' && <ColdView />}
        {view === 'watch' && <WatchView />}
        {view === 'records' && <RecordsView />}
        {view === 'settings' && <SettingsView />}
      </Content>
    </Layout>
  )
}
