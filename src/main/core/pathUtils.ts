// 路径工具。纯函数，便于单测。对应 TECH_DESIGN.md §7。

/** 规范化 Windows 路径：统一分隔符为 \，去除尾部分隔符（盘根保留），折叠重复分隔符。 */
export function normalizePath(p: string): string {
  let s = p.trim().replace(/\//g, '\\')
  // 折叠重复反斜杠，但保留 UNC 前导 \\
  const uncPrefix = s.startsWith('\\\\') ? '\\\\' : ''
  s = uncPrefix + s.slice(uncPrefix.length).replace(/\\+/g, '\\')
  // 去尾部分隔符，但盘根 (C:\) 保留尾斜杠语义时统一为不带尾
  if (s.length > 3 && s.endsWith('\\')) s = s.slice(0, -1)
  return s
}

/** 是否为盘根，如 C:\ 或 C: */
export function isDriveRoot(p: string): boolean {
  const s = normalizePath(p)
  return /^[a-zA-Z]:\\?$/.test(s)
}

/** 取盘符大写，如 C:。非盘符路径返回 null。 */
export function driveLetter(p: string): string | null {
  const m = normalizePath(p).match(/^([a-zA-Z]:)/)
  return m ? m[1].toUpperCase() : null
}

/** 是否含未展开的通配符 */
export function hasWildcard(p: string): boolean {
  return /[*?]/.test(p)
}

/** 是否为绝对 Windows 路径（盘符或 UNC） */
export function isAbsoluteWin(p: string): boolean {
  const s = normalizePath(p)
  return /^[a-zA-Z]:\\/.test(s) || s.startsWith('\\\\')
}

/** child 是否在 parent 之内（含相等）。大小写不敏感。 */
export function isUnder(parent: string, child: string): boolean {
  const a = normalizePath(parent).toUpperCase()
  const b = normalizePath(child).toUpperCase()
  return b === a || b.startsWith(a + '\\')
}

/** 展开 %ENV% 占位符为实际值，缺失的变量保持原样。 */
export function expandEnv(p: string, env: NodeJS.ProcessEnv = process.env): string {
  return p.replace(/%([^%]+)%/g, (whole, name) => {
    const v = env[name] ?? env[name.toUpperCase()] ?? env[name.toLowerCase()]
    return v ?? whole
  })
}

/** 简单 glob → RegExp（支持 * ? 与路径段，不支持 **）。大小写不敏感。 */
export function globToRegExp(glob: string): RegExp {
  const norm = normalizePath(glob)
  let re = ''
  for (const ch of norm) {
    if (ch === '*') re += '[^\\\\]*'
    else if (ch === '?') re += '[^\\\\]'
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'i')
}
