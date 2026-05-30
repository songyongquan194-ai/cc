import { describe, it, expect, vi } from 'vitest'
import { LocalProvider, isLocalEndpoint, type FetchLike } from '../LocalProvider'

const cfg = { endpoint: 'http://localhost:11434', model: 'qwen2.5' }

describe('isLocalEndpoint', () => {
  it('只认本机回环', () => {
    expect(isLocalEndpoint('http://localhost:11434')).toBe(true)
    expect(isLocalEndpoint('http://127.0.0.1:11434')).toBe(true)
    expect(isLocalEndpoint('https://api.openai.com')).toBe(false)
    expect(isLocalEndpoint('http://192.168.1.5:11434')).toBe(false)
    expect(isLocalEndpoint('not-a-url')).toBe(false)
  })
})

describe('LocalProvider', () => {
  it('available: /api/tags ok 返回 true', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    const p = new LocalProvider(cfg, fetchImpl)
    expect(await p.available()).toBe(true)
  })

  it('available: 非本机端点直接 false，不发请求', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    const p = new LocalProvider({ ...cfg, endpoint: 'https://api.example.com' }, fetchImpl)
    expect(await p.available()).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('available: fetch 抛出时返回 false 不抛', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => { throw new Error('refused') })
    const p = new LocalProvider(cfg, fetchImpl)
    expect(await p.available()).toBe(false)
  })

  it('available: GET 不带 body（模拟真实 fetch 对 GET+body 抛错）', async () => {
    // 真实 undici：GET/HEAD 带 body 会抛 "Request with GET/HEAD method cannot have body"
    const fetchImpl: FetchLike = vi.fn(async (_url, init) => {
      if (init.method === 'GET' && init.body !== undefined) {
        throw new TypeError('Request with GET/HEAD method cannot have body.')
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })
    const p = new LocalProvider(cfg, fetchImpl)
    expect(await p.available()).toBe(true)
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringMatching(/\/api\/tags$/), expect.not.objectContaining({ body: expect.anything() }))
  })

  it('complete: 提取 message.content', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ message: { content: '{"summary":"ok"}' } })
    }))
    const p = new LocalProvider(cfg, fetchImpl)
    expect(await p.complete('hi')).toBe('{"summary":"ok"}')
  })

  it('complete: 非本机端点抛出（零云端保险）', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    const p = new LocalProvider({ ...cfg, endpoint: 'https://evil.com' }, fetchImpl)
    await expect(p.complete('hi')).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('complete: 空内容抛出', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ message: { content: '' } })
    }))
    const p = new LocalProvider(cfg, fetchImpl)
    await expect(p.complete('hi')).rejects.toThrow()
  })
})
