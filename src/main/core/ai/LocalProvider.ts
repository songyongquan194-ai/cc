// 本地模型 Provider（PRD §13.1）。对接本机 Ollama 兼容端点，零云端发送、无需 API key。
// fetch 通过构造注入，便于单测（不依赖真实模型）。

import type { AIProvider, AIProviderConfig } from './AIProvider'

/** 最小 fetch 抽象，避免绑定 DOM lib 类型。 */
export type FetchLike = (
  url: string,
  init: {
    method: string
    headers: Record<string, string>
    // GET/HEAD 不能带 body，否则真实 fetch(undici) 会抛错，故设为可选。
    body?: string
    signal?: AbortSignal
  }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

const DEFAULT_TIMEOUT = 20_000

/** 仅允许本机回环地址，杜绝任何云端/外网发送。 */
export function isLocalEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint)
    const host = u.hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0'
  } catch {
    return false
  }
}

export class LocalProvider implements AIProvider {
  constructor(
    private cfg: AIProviderConfig,
    private fetchImpl: FetchLike
  ) {}

  describe(): { endpoint: string; model: string } {
    return { endpoint: this.cfg.endpoint, model: this.cfg.model }
  }

  /** 探活：调用 /api/tags，端点为本机且返回 ok 才算可用。绝不抛出。 */
  async available(): Promise<boolean> {
    if (!isLocalEndpoint(this.cfg.endpoint)) return false
    try {
      const res = await this.fetchImpl(this.join('/api/tags'), {
        method: 'GET',
        headers: {}
      })
      return res.ok
    } catch {
      return false
    }
  }

  /** 调用 /api/chat（非流式 + JSON 模式），返回模型文本。失败抛出。 */
  async complete(prompt: string): Promise<string> {
    if (!isLocalEndpoint(this.cfg.endpoint)) {
      throw new Error('AI 端点必须是本机地址（零云端发送）')
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs ?? DEFAULT_TIMEOUT)
    try {
      const res = await this.fetchImpl(this.join('/api/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.cfg.model,
          stream: false,
          format: 'json',
          options: { temperature: 0.2 },
          messages: [{ role: 'user', content: prompt }]
        }),
        signal: controller.signal
      })
      if (!res.ok) throw new Error(`本地模型返回 HTTP ${res.status}`)
      const data = (await res.json()) as { message?: { content?: string } }
      const content = data.message?.content
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('本地模型返回空内容')
      }
      return content
    } finally {
      clearTimeout(timer)
    }
  }

  private join(path: string): string {
    return this.cfg.endpoint.replace(/\/+$/, '') + path
  }
}
