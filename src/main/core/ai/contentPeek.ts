// 文件内容预览的安全闸门（PRD §13 隐私边界的受控放宽）。
// 仅对“安全的小文本文件”读取开头少量字节，交给本机模型判断；
// 凭据/密钥/Cookie/钱包等敏感文件与高风险项一律拒绝读取内容。
// 读取到的片段只发本机 Ollama，绝不出网（由 LocalProvider.isLocalEndpoint 兜底）。

import type { AIIdentifyInput } from '@shared/types'
import type { PlatformProfile } from '../platform'
import { getActiveProfile } from '../platform'

/** 允许读取内容的文本类扩展名白名单。 */
const PEEK_EXTS = new Set([
  '.txt', '.log', '.md', '.json', '.csv', '.tsv', '.xml', '.yaml', '.yml',
  '.ini', '.cfg', '.conf', '.html', '.htm', '.css', '.js', '.mjs', '.cjs',
  '.ts', '.tsx', '.jsx', '.py', '.java', '.kt', '.go', '.rs', '.c', '.cc',
  '.cpp', '.h', '.hpp', '.cs', '.rb', '.php', '.lua', '.sql', '.sh', '.ps1',
  '.bat', '.toml', '.properties', '.srt', '.vtt'
])

/** 敏感文件名/扩展名：即便是文本也绝不读取内容。 */
const SENSITIVE_NAME = /(\.env|\.pem|\.key|\.pfx|\.p12|\.keystore|\.kdbx|\.ovpn|id_rsa|id_ed25519|secret|password|passwd|credential|token|wallet|cookie)/i

/** 敏感目录片段（统一用 / 分隔，匹配前会把路径分隔符归一化为 /）。其下文件不读内容。 */
const SENSITIVE_DIR = [
  '/COOKIES', '/LOGIN DATA', '/WEB DATA', '/.SSH/', '/.AWS/', '/.GNUPG/',
  '/KEYRINGS/', '/CREDENTIAL', '/WALLET', '/.DOCKER/CONTEXTS'
]

/** 仅对 ≤512KB 的文件考虑读取片段。 */
export const MAX_PEEK_SIZE = 512 * 1024

/** 该文件是否允许读取内容片段（安全闸门）。 */
export function shouldPeekContent(
  input: AIIdentifyInput,
  profile: PlatformProfile = getActiveProfile()
): boolean {
  if (input.risk_level === 'high' || input.risk_level === 'forbidden') return false
  if (!input.size_bytes || input.size_bytes <= 0 || input.size_bytes > MAX_PEEK_SIZE) return false
  if (!PEEK_EXTS.has((input.ext || '').toLowerCase())) return false

  const norm = profile.normalizePath(input.path)
  if (profile.isForbidden(norm)) return false
  // 归一化为 / 分隔后做敏感目录/文件名判定，兼容两平台。
  const up = norm.toUpperCase().replace(/\\/g, '/')
  const base = profile.path.basename(norm).toUpperCase()
  if (SENSITIVE_NAME.test(base)) return false
  if (SENSITIVE_DIR.some((d) => up.includes(d))) return false
  return true
}

/**
 * 把读到的原始文本净化为可作为提示的小片段；判定为二进制或空白则返回 null。
 * 折叠空白并截断，避免把大段内容塞进 prompt。
 */
export function sanitizeSnippet(raw: string, maxChars = 1000): string | null {
  if (!raw) return null
  let nul = 0
  let ctrl = 0
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i)
    if (c === 0) nul++
    else if (c < 9 || (c > 13 && c < 32)) ctrl++
  }
  if (nul > 0) return null // 含 NUL 视为二进制
  if (raw.length > 0 && ctrl / raw.length > 0.1) return null // 不可打印占比过高
  const cleaned = raw.replace(/\s+/g, ' ').trim()
  if (!cleaned) return null
  return cleaned.length > maxChars ? cleaned.slice(0, maxChars) + '…' : cleaned
}
