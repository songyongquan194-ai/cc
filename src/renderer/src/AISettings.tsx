import { useEffect, useState } from 'react'
import {
  Button, Card, Input, Space, Typography, message, Switch, Tag, Alert, Modal, List, Descriptions
} from 'antd'
import type { AIStatus, AIRuleDraft, Rule } from '@shared/types'

const { Text, Paragraph } = Typography
const { TextArea } = Input

type UserRule = { id: string; rule: Rule; enabled: boolean; created_at: string }

export default function AISettings(): JSX.Element {
  const [enabled, setEnabled] = useState(false)
  const [endpoint, setEndpoint] = useState('http://localhost:11434')
  const [model, setModel] = useState('')
  const [status, setStatus] = useState<AIStatus | null>(null)
  const [checking, setChecking] = useState(false)

  const [nl, setNl] = useState('')
  const [parsing, setParsing] = useState(false)
  const [draft, setDraft] = useState<AIRuleDraft | null>(null)
  const [rules, setRules] = useState<UserRule[]>([])

  const load = async (): Promise<void> => {
    setEnabled(await window.api.settings.get<boolean>('ai_enabled', false))
    setEndpoint(await window.api.settings.get<string>('ai_endpoint', 'http://localhost:11434'))
    setModel(await window.api.settings.get<string>('ai_model', ''))
    setRules(await window.api.rules.list())
  }

  useEffect(() => {
    void load()
  }, [])

  const saveConfig = async (next?: Partial<{ enabled: boolean; endpoint: string; model: string }>): Promise<void> => {
    const e = next?.enabled ?? enabled
    const ep = next?.endpoint ?? endpoint
    const m = next?.model ?? model
    await window.api.settings.set('ai_enabled', e)
    await window.api.settings.set('ai_endpoint', ep.trim())
    await window.api.settings.set('ai_model', m.trim())
  }

  const check = async (): Promise<void> => {
    setChecking(true)
    try {
      await saveConfig()
      setStatus(await window.api.ai.status())
    } finally {
      setChecking(false)
    }
  }

  const parse = async (): Promise<void> => {
    if (!nl.trim()) {
      message.warning('请先描述你的整理需求，例如：把下载目录里超过30天的安装包迁移冷藏')
      return
    }
    setParsing(true)
    try {
      const d = await window.api.ai.parseRule(nl.trim())
      setDraft(d)
      if (!d.ok) message.error(d.error ?? '解析失败')
    } finally {
      setParsing(false)
    }
  }

  const confirmRule = async (): Promise<void> => {
    if (!draft?.rule) return
    const r = await window.api.rules.save(draft.rule)
    if (r.ok) {
      message.success('规则已添加，下次扫描即生效')
      setDraft(null)
      setNl('')
      setRules(await window.api.rules.list())
    } else {
      message.error(r.error ?? '保存失败')
    }
  }

  const deleteRule = async (id: string): Promise<void> => {
    await window.api.rules.delete(id)
    setRules(await window.api.rules.list())
  }

  return (
    <>
      <Card size="small" title="AI 顾问（本地 · 零云端）">
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 12 }}
          message="隐私保障"
          description={
            <Text type="secondary">
              AI 仅连接<Text strong>本机</Text>模型（Ollama 兼容端点，如 http://localhost:11434），
              <Text strong>不向任何云端发送数据</Text>，也只读取文件的元数据（路径/大小/时间/分类），
              <Text strong>绝不读取文件内容</Text>。AI 只提供解释与建议，
              <Text strong>不会自动删除或迁移任何文件</Text>。未启用时使用内置规则解释。
            </Text>
          }
        />
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Space>
            <Text>启用 AI 顾问：</Text>
            <Switch
              checked={enabled}
              onChange={async (v) => {
                setEnabled(v)
                await saveConfig({ enabled: v })
              }}
            />
          </Space>
          <Space wrap>
            <Text>本地端点：</Text>
            <Input
              style={{ width: 300 }}
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              onBlur={() => void saveConfig()}
              placeholder="http://localhost:11434"
            />
            <Text>模型名：</Text>
            <Input
              style={{ width: 180 }}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              onBlur={() => void saveConfig()}
              placeholder="如 qwen2.5"
            />
            <Button loading={checking} onClick={() => void check()}>
              检测
            </Button>
          </Space>
          {status && (
            <Space>
              {status.available ? (
                <Tag color="green">本地模型可用</Tag>
              ) : (
                <Tag color="red">不可用</Tag>
              )}
              {status.error && <Text type="secondary">{status.error}</Text>}
            </Space>
          )}
        </Space>
      </Card>

      <Card size="small" title="自然语言规则（需启用 AI）" style={{ marginTop: 16 }}>
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="AI 生成的规则不会立即生效，必须经你预览确认后才会加入。系统会自动拒绝任何触碰系统关键目录或高风险的规则。"
        />
        <Space direction="vertical" style={{ width: '100%' }}>
          <TextArea
            rows={2}
            value={nl}
            onChange={(e) => setNl(e.target.value)}
            placeholder="用一句话描述，例如：把下载目录里超过 30 天的 .zip 安装包迁移到冷藏"
            spellCheck={false}
          />
          <Button type="primary" loading={parsing} onClick={() => void parse()} disabled={!enabled}>
            生成规则草案
          </Button>
          {rules.length > 0 && (
            <List
              size="small"
              header={<Text type="secondary">已添加的自然语言规则</Text>}
              dataSource={rules}
              renderItem={(r) => (
                <List.Item
                  actions={[
                    <Button key="del" size="small" danger type="link" onClick={() => void deleteRule(r.id)}>
                      删除
                    </Button>
                  ]}
                >
                  <Space>
                    <Text>{r.rule.name}</Text>
                    <Tag>{r.rule.default_action === 'migrate' ? '迁移冷藏' : '清理'}</Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {r.rule.match.path_globs.join('；')}
                    </Text>
                  </Space>
                </List.Item>
              )}
            />
          )}
        </Space>
      </Card>

      <Modal
        open={!!draft?.ok}
        title="预览规则草案 — 确认后才会生效"
        okText="确认添加"
        cancelText="取消"
        onOk={() => void confirmRule()}
        onCancel={() => setDraft(null)}
        width={640}
      >
        {draft?.rule && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="名称">{draft.rule.name}</Descriptions.Item>
              <Descriptions.Item label="说明">{draft.rule.explain}</Descriptions.Item>
              <Descriptions.Item label="匹配路径">
                {draft.rule.match.path_globs.join('；')}
              </Descriptions.Item>
              {draft.rule.match.ext_in && draft.rule.match.ext_in.length > 0 && (
                <Descriptions.Item label="扩展名">{draft.rule.match.ext_in.join('、')}</Descriptions.Item>
              )}
              <Descriptions.Item label="风险等级">{draft.rule.risk_level}</Descriptions.Item>
              <Descriptions.Item label="动作">
                {draft.rule.default_action === 'migrate' ? '迁移冷藏（不删除）' : '安全清理'}
              </Descriptions.Item>
            </Descriptions>
            {draft.warnings.length > 0 && (
              <Alert
                type="warning"
                showIcon
                message="安全收敛提示"
                description={
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {draft.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                }
              />
            )}
            <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
              该规则以最低优先级运行，永远不会覆盖系统保护与高风险保护。
            </Paragraph>
          </Space>
        )}
      </Modal>
    </>
  )
}
