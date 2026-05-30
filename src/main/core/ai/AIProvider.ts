// AI 提供方抽象（PRD §13）。采用「直连 HTTP API」调用模式 + Provider 抽象。
// 初期只实现 LocalProvider（本机 Ollama 兼容端点），零云端发送、无需 API key。

/** Provider 配置（来自 settings）。 */
export interface AIProviderConfig {
  /** 本地端点根地址，如 http://localhost:11434 */
  endpoint: string
  /** 模型名，如 qwen2.5、llama3.1 */
  model: string
  /** 单次请求超时（毫秒）。 */
  timeoutMs?: number
}

/**
 * AI Provider 抽象。所有实现必须满足：
 * - 仅做文本补全，不触碰文件系统、不执行任何操作；
 * - 输入为调用方构造好的 prompt 字符串（已仅含元数据）；
 * - 不可用时 available() 返回 false，调用方据此降级到模板。
 */
export interface AIProvider {
  /** 探活：本地模型是否可用。绝不抛出，失败返回 false。 */
  available(): Promise<boolean>
  /** 纯文本补全。强制 JSON 模式由实现负责。失败抛出，调用方降级。 */
  complete(prompt: string): Promise<string>
  /** 当前生效的端点与模型（用于状态展示）。 */
  describe(): { endpoint: string; model: string }
}
