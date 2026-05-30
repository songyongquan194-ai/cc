import { normalizePath } from './pathUtils'

/**
 * 深度扫描"大文件兜底迁移"的安全过滤。
 *
 * 背景：未命中任何规则、但体积超阈值的文件会被标记为可迁移冷藏。
 * 但有一类大文件迁走会直接破坏应用——可执行体 / 动态库 / 运行时组件 / 模型权重，
 * 应用按绝对路径加载它们，文件一旦被移走就报错（典型：剪映迁移 onnxruntime/cuDNN 后报 1354）。
 * 这些必须排除在自动迁移之外（仍可被显式规则单独处理）。
 */

/** 可执行 / 运行库 / 运行时数据扩展名：绝不进入大文件兜底迁移。 */
const RUNTIME_EXTS = new Set([
  // 可执行与动态库
  '.dll', '.exe', '.sys', '.so', '.node', '.pyd', '.ocx', '.drv', '.dylib',
  '.efi', '.scr', '.cpl', '.com', '.ax', '.winmd', '.tlb', '.mui', '.pdb',
  '.lib', '.bin', '.msix', '.appx',
  // 机器学习模型 / 运行时权重（应用按路径加载）
  '.model', '.onnx', '.pb', '.tflite', '.gguf', '.safetensors', '.pt', '.pth',
  '.caffemodel', '.params', '.weights',
  // 运行时资源包
  '.pak', '.wasm'
])

/** 应用内部"运行时组件/安装"目录标记：其下文件视为应用自有组件，不参与兜底迁移。 */
const RUNTIME_DIR_MARKERS = [
  '\\COMPONENTSTORE\\', // 如 JianyingPro\User Data\ComponentStore\onnxruntime_gpu\...
  '\\COMPONENTS\\',
  '\\RUNTIME\\',
  '\\RUNTIMES\\'
]

/**
 * 该"大文件"是否适合作为兜底项自动迁移冷藏。
 * 仅排除明显的应用运行时/二进制；其余大文件（媒体、压缩包、镜像等惰性数据）仍可迁移。
 */
export function isMigratableLargeFile(path: string, ext: string): boolean {
  const e = (ext || '').toLowerCase()
  if (RUNTIME_EXTS.has(e)) return false
  const up = normalizePath(path).toUpperCase()
  if (RUNTIME_DIR_MARKERS.some((m) => up.includes(m))) return false
  return true
}
