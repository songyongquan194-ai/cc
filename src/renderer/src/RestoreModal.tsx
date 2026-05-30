import { useEffect, useState } from 'react'
import { Modal, Radio, Checkbox, Space, Typography, Alert, Spin, message } from 'antd'
import type { ColdItem } from '@shared/types'
import { formatBytes } from './format'

const { Text, Paragraph } = Typography

type Conflict = 'keep_both' | 'overwrite' | 'cancel'

const ISSUE_LABEL: Record<string, string> = {
  cold_missing: '冷藏文件已丢失，无法恢复',
  forbidden_target: '原位置是系统关键目录，禁止恢复到此处',
  parent_missing: '原路径的上级目录已不存在',
  target_exists: '原位置已存在同名文件',
  insufficient_space: '目标磁盘空间不足'
}

export default function RestoreModal({
  item,
  onClose,
  onDone
}: {
  item: ColdItem
  onClose: () => void
  onDone: () => void
}): JSX.Element {
  const [loading, setLoading] = useState(true)
  const [issues, setIssues] = useState<string[]>([])
  const [target, setTarget] = useState(item.original_path)
  const [conflict, setConflict] = useState<Conflict>('keep_both')
  const [overwriteConfirmed, setOverwriteConfirmed] = useState(false)
  const [removeCold, setRemoveCold] = useState(false)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    void (async () => {
      const pc = await window.api.restore.precheck(item.id)
      setIssues(pc.issues)
      setTarget(pc.target_path || item.original_path)
      setLoading(false)
    })()
  }, [item.id])

  const blocked = issues.includes('forbidden_target') || issues.includes('cold_missing')
  const needConflict = issues.includes('target_exists')
  const needParent = issues.includes('parent_missing')
  const lowSpace = issues.includes('insufficient_space')

  const canSubmit =
    !blocked &&
    !lowSpace &&
    !(needConflict && conflict === 'overwrite' && !overwriteConfirmed)

  const submit = async (): Promise<void> => {
    setRunning(true)
    try {
      const r = await window.api.restore.run(item.id, {
        createParent: needParent ? true : undefined,
        onConflict: needConflict ? conflict : undefined,
        removeCold
      })
      if (r.status === 'done') {
        message.success('已恢复到：' + r.restored_path)
        onDone()
      } else if (r.status === 'cancelled') {
        message.info('已取消恢复')
      } else {
        message.error('恢复失败：' + (r.error_code ?? '') + ' ' + (r.error_detail ?? ''))
        onDone() // 刷新（可能标记为不可恢复）
      }
    } finally {
      setRunning(false)
    }
  }

  return (
    <Modal
      open
      title="恢复到原位置"
      onCancel={onClose}
      onOk={submit}
      okText="恢复"
      okButtonProps={{ disabled: !canSubmit, loading: running }}
      cancelText="关闭"
      width={560}
    >
      {loading ? (
        <Spin />
      ) : (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Paragraph>
            <Text type="secondary">原路径：</Text>
            <br />
            <Text code>{target}</Text>
            <br />
            <Text type="secondary">大小：{formatBytes(item.size_bytes)}</Text>
          </Paragraph>

          {issues.map((i) => (
            <Alert
              key={i}
              type={i === 'forbidden_target' || i === 'cold_missing' || i === 'insufficient_space' ? 'error' : 'warning'}
              showIcon
              message={ISSUE_LABEL[i] ?? i}
            />
          ))}

          {needParent && !blocked && (
            <Text type="secondary">恢复时将自动重建缺失的上级目录。</Text>
          )}

          {needConflict && !blocked && (
            <Space direction="vertical">
              <Text strong>同名文件处置：</Text>
              <Radio.Group value={conflict} onChange={(e) => setConflict(e.target.value)}>
                <Space direction="vertical">
                  <Radio value="keep_both">保留两者（恢复为新文件名）</Radio>
                  <Radio value="overwrite">覆盖现有文件</Radio>
                  <Radio value="cancel">取消恢复</Radio>
                </Space>
              </Radio.Group>
              {conflict === 'overwrite' && (
                <Checkbox checked={overwriteConfirmed} onChange={(e) => setOverwriteConfirmed(e.target.checked)}>
                  <Text type="danger">我确认覆盖现有文件（不可撤销）</Text>
                </Checkbox>
              )}
            </Space>
          )}

          {!blocked && !lowSpace && (
            <Checkbox checked={removeCold} onChange={(e) => setRemoveCold(e.target.checked)}>
              恢复成功后删除冷藏副本（释放备份盘空间）
            </Checkbox>
          )}
        </Space>
      )}
    </Modal>
  )
}
