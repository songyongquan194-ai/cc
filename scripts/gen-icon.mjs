// 生成应用图标 build/icon.ico（多分辨率，内嵌 PNG）。
// 主题：C 盘清理 —— antd 蓝圆角磁贴 + 白色「C」。无外部依赖，仅用 Node zlib。
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'build')

const BG = [24, 144, 255] // #1890ff
const BG2 = [9, 109, 217] // #096dd9 深一档，做斜向渐变
const WHITE = [255, 255, 255]

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t)
}

/** 渲染单个尺寸的 RGBA 像素缓冲。 */
function render(size) {
  const px = Buffer.alloc(size * size * 4)
  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 4
    // alpha 混合到已有像素，做简单抗锯齿
    const ia = a / 255
    px[i] = lerp(px[i], r, ia)
    px[i + 1] = lerp(px[i + 1], g, ia)
    px[i + 2] = lerp(px[i + 2], b, ia)
    px[i + 3] = Math.max(px[i + 3], a)
  }

  const margin = size * 0.06
  const radius = size * 0.22
  const left = margin
  const top = margin
  const right = size - margin
  const bottom = size - margin

  // 圆角矩形背景（带斜向渐变 + 边缘抗锯齿）
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x + 0.5
      const cy = y + 0.5
      // 到圆角矩形的有符号距离
      const qx = Math.max(left - cx, cx - right, 0)
      const qy = Math.max(top - cy, cy - bottom, 0)
      // 内缩 radius 的矩形 + 圆角
      const rx = Math.min(Math.max(cx, left + radius), right - radius)
      const ry = Math.min(Math.max(cy, top + radius), bottom - radius)
      const inside =
        cx >= left && cx <= right && cy >= top && cy <= bottom
          ? Math.hypot(cx - rx, cy - ry) <= radius ||
            cx >= left + radius && cx <= right - radius ||
            cy >= top + radius && cy <= bottom - radius
          : false
      if (!inside && !(qx === 0 && qy === 0)) continue
      // 抗锯齿：用到圆角中心的距离做边缘羽化
      let a = 255
      const dCorner = Math.hypot(cx - rx, cy - ry)
      const nearCorner =
        (cx < left + radius || cx > right - radius) &&
        (cy < top + radius || cy > bottom - radius)
      if (nearCorner) {
        const edge = radius - dCorner
        if (edge < 0) continue
        if (edge < 1) a = Math.round(edge * 255)
      } else if (cx < left || cx > right || cy < top || cy > bottom) {
        continue
      }
      const t = (x + y) / (2 * size)
      set(x, y, [lerp(BG[0], BG2[0], t), lerp(BG[1], BG2[1], t), lerp(BG[2], BG2[2], t)], a)
    }
  }

  // 白色「C」：圆环 + 右侧开口
  const ccx = size / 2
  const ccy = size / 2
  const R = size * 0.3
  const T = size * 0.11
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - ccx
      const dy = y + 0.5 - ccy
      const d = Math.hypot(dx, dy)
      const ring = Math.abs(d - R)
      if (ring > T / 2 + 1) continue
      const ang = Math.atan2(dy, dx) // -PI..PI；0 指向右
      // 右侧开口（约 ±42°）
      if (Math.abs(ang) < Math.PI * 0.23) continue
      let a = 255
      const edge = T / 2 - ring
      if (edge < 1) a = Math.max(0, Math.round((edge + 1) * 127))
      set(x, y, WHITE, a)
    }
  }
  return px
}

/** 把 RGBA 缓冲编码为 PNG。 */
function encodePng(px, size) {
  const crcTable = (() => {
    const t = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c >>> 0
    }
    return t
  })()
  const crc32 = (buf) => {
    let c = 0xffffffff
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const t = Buffer.from(type)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
    return Buffer.concat([len, t, data, crc])
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

/** 组装 ICO（多张内嵌 PNG）。 */
function buildIco(sizes) {
  const images = sizes.map((s) => ({ size: s, png: encodePng(render(s), s) }))
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type icon
  header.writeUInt16LE(images.length, 4)
  const entries = []
  let offset = 6 + images.length * 16
  for (const img of images) {
    const e = Buffer.alloc(16)
    e[0] = img.size >= 256 ? 0 : img.size // width
    e[1] = img.size >= 256 ? 0 : img.size // height
    e[2] = 0 // palette
    e[3] = 0
    e.writeUInt16LE(1, 4) // planes
    e.writeUInt16LE(32, 6) // bpp
    e.writeUInt32LE(img.png.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += img.png.length
    entries.push(e)
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)])
}

mkdirSync(OUT_DIR, { recursive: true })
const ico = buildIco([16, 24, 32, 48, 64, 128, 256])
writeFileSync(join(OUT_DIR, 'icon.ico'), ico)
// 同时输出 256 PNG，便于其它用途
writeFileSync(join(OUT_DIR, 'icon.png'), encodePng(render(256), 256))
console.log(`icon.ico 生成完毕：${ico.length} 字节`)
