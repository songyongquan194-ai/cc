export function formatBytes(n: number): string {
  if (!n || n < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

export const RISK_LABEL: Record<string, string> = {
  safe: '安全',
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  forbidden: '禁止'
}

export const RISK_COLOR: Record<string, string> = {
  safe: 'green',
  low: 'cyan',
  medium: 'orange',
  high: 'red',
  forbidden: 'magenta'
}

export const ACTION_LABEL: Record<string, string> = {
  none: '仅展示',
  clean: '可清理',
  migrate: '建议迁移'
}

export const CATEGORY_LABEL: Record<string, string> = {
  sys_temp: '系统临时文件',
  sys_update_cache: 'Windows 更新缓存',
  sys_thumbnail: '缩略图缓存',
  sys_crashdump: '崩溃转储',
  sys_recyclebin: '回收站',
  browser_cache: '浏览器缓存',
  browser_gpu: '浏览器 GPU 缓存',
  browser_sw: 'Service Worker 缓存',
  browser_profile: '浏览器用户数据',
  dev_pkg_cache: '包管理器缓存',
  dev_pip_cache: 'pip 缓存',
  dev_jvm_cache: 'JVM 构建缓存',
  dev_cargo_cache: 'Cargo 缓存',
  dev_node_modules: 'node_modules',
  dev_build_output: '构建产物',
  design_media_cache: '设计软件媒体缓存',
  pkg_installer: '安装包/镜像',
  vm_wsl: 'WSL/容器磁盘',
  media_video: '大文件',
  uncategorized: '未分类'
}

export function catLabel(c: string): string {
  return CATEGORY_LABEL[c] ?? c
}
