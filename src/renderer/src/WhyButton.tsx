import { useState } from 'react'
import { Button, Modal, Typography, Tag, Spin, List, Space } from 'antd'
import type { AIAdvice, AIExplainInput } from '@shared/types'

const { Paragraph, Text } = Typography

/**
 * 「为什么」按钮：按需向本地 AI（或模板降级）请求结构化解释。
 * 仅传元数据，绝不传文件内容；advisory-only，不触发任何操作。
 */
export default function WhyButton({
  input,
  size = 'small'
}: {
  input: AIExplainInput
  size?: 'small' | 'middle'
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [advice, setAdvice] = useState<AIAdvice | null>(null)

  const ask = async (): Promise<void> => {
    setOpen(true)
    setLoading(true)
    setAdvice(null)
    try {
      setAdvice(await window.api.ai.explain(input))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button size={size} type="link" onClick={() => void ask()}>
        为什么
      </Button>
      <Modal
        open={open}
        title={
          <Space>
            为什么这样建议
            {advice &&
              (advice.ai_generated ? (
                <Tag color="purple">本地 AI</Tag>
              ) : (
                <Tag>规则解释</Tag>
              ))}
          </Space>
        }
        footer={<Button onClick={() => setOpen(false)}>关闭</Button>}
        onCancel={() => setOpen(false)}
        width={640}
      >
        {loading || !advice ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin />
          </div>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Paragraph style={{ marginBottom: 0 }}>
              <Text strong>{advice.summary}</Text>
            </Paragraph>
            {advice.basis.length > 0 && (
              <div>
                <Text type="secondary">判断依据</Text>
                <List
                  size="small"
                  dataSource={advice.basis}
                  renderItem={(b) => <List.Item style={{ paddingBlock: 4 }}>{b}</List.Item>}
                />
              </div>
            )}
            {advice.risks.length > 0 && (
              <div>
                <Text type="secondary">风险提示</Text>
                <List
                  size="small"
                  dataSource={advice.risks}
                  renderItem={(r) => (
                    <List.Item style={{ paddingBlock: 4 }}>
                      <Text type="warning">{r}</Text>
                    </List.Item>
                  )}
                />
              </div>
            )}
            {advice.recommendation && (
              <Paragraph style={{ marginBottom: 0 }}>
                <Text type="secondary">建议：</Text> {advice.recommendation}
              </Paragraph>
            )}
            {advice.uncertainty && (
              <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
                不确定性：{advice.uncertainty}
              </Paragraph>
            )}
          </Space>
        )}
      </Modal>
    </>
  )
}
