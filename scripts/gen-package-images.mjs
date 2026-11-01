/**
 * 内置封装示意图生成器（KiCad 数据源版）
 * - 从 KiCad 官方封装库 kicad-footprints 拉取 .kicad_mod，按真实机械几何生成俯视 SVG
 * - 源文件缓存到 scripts/kicad-cache/（断网可重复生成；删除缓存则重新下载）
 * - 输出到 public/packages/builtin/<封装名>.svg，透明底
 * - 所有封装共用同一 mm→px 比例尺，不同封装的真实尺寸差异在图上一眼可辨
 * 用法：node scripts/gen-package-images.mjs（幂等）
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE_DIR = join(ROOT, 'scripts', 'kicad-cache')
const OUT_DIR = join(ROOT, 'public', 'packages', 'builtin')
mkdirSync(CACHE_DIR, { recursive: true })
mkdirSync(OUT_DIR, { recursive: true })

const RAW_BASE = 'https://raw.githubusercontent.com/KiCad/kicad-footprints/master'

// ===== 封装名 → KiCad 封装文件（选型依据见各注释；均来自官方库实测几何）=====
const SPECS = {
  // 贴片：SOP-8 拆 150mil 窄体 / 208mil 宽体（SPI Flash 两种都有）
  'sop-8-150mil': 'Package_SO.pretty/SOIC-8_3.9x4.9mm_P1.27mm.kicad_mod',
  'sop-8-208mil': 'Package_SO.pretty/SOIC-8_5.275x5.275mm_P1.27mm.kicad_mod',
  'sop-16':       'Package_SO.pretty/SOIC-16_3.9x9.9mm_P1.27mm.kicad_mod',
  'tssop-8':      'Package_SO.pretty/TSSOP-8_4.4x3mm_P0.65mm.kicad_mod',
  'tssop-14':     'Package_SO.pretty/TSSOP-14_4.4x5mm_P0.65mm.kicad_mod',
  'tssop-16':     'Package_SO.pretty/TSSOP-16_4.4x5mm_P0.65mm.kicad_mod',
  'msop-8':       'Package_SO.pretty/MSOP-8_3x3mm_P0.65mm.kicad_mod',
  'ssop-8':       'Package_SO.pretty/SSOP-8_3.9x5.05mm_P1.27mm.kicad_mod',
  'ssop-20':      'Package_SO.pretty/SSOP-20_5.3x7.2mm_P0.65mm.kicad_mod',
  'sot-23-5':     'Package_TO_SOT_SMD.pretty/SOT-23-5.kicad_mod',
  'sot-23-6':     'Package_TO_SOT_SMD.pretty/SOT-23-6.kicad_mod',
  // 无引脚（WSON-8 用 SPI Flash 经典 6x5；USON-8 用同库最小 WSON 2x2 代表；
  // KiCad 无 QFN-8 条目，用同尺寸 DFN-8 3x3 图形代表，焊盘布局一致）
  'wson-8':       'Package_SON.pretty/WSON-8-1EP_6x5mm_P1.27mm_EP3.4x4.3mm.kicad_mod',
  'uson-8':       'Package_SON.pretty/WSON-8-1EP_2x2mm_P0.5mm_EP0.9x1.6mm.kicad_mod',
  'dfn-8':        'Package_DFN_QFN.pretty/DFN-8-1EP_2x3mm_P0.5mm_EP0.56x2.15mm.kicad_mod',
  'qfn-8':        'Package_DFN_QFN.pretty/DFN-8-1EP_3x3mm_P0.65mm_EP1.55x2.4mm.kicad_mod',
  'qfn-24':       'Package_DFN_QFN.pretty/QFN-24-1EP_4x4mm_P0.5mm_EP2.65x2.65mm.kicad_mod',
  'qfn-32':       'Package_DFN_QFN.pretty/QFN-32-1EP_5x5mm_P0.5mm_EP3.6x3.6mm.kicad_mod',
  'qfn-48':       'Package_DFN_QFN.pretty/QFN-48-1EP_7x7mm_P0.5mm_EP5.3x5.3mm.kicad_mod',
  // 直插
  'dip-8':        'Package_DIP.pretty/DIP-8_W7.62mm.kicad_mod',
  'dip-14':       'Package_DIP.pretty/DIP-14_W7.62mm.kicad_mod',
  'dip-16':       'Package_DIP.pretty/DIP-16_W7.62mm.kicad_mod',
  // 四边引脚 / 阵列
  'lqfp-32':      'Package_QFP.pretty/LQFP-32_7x7mm_P0.8mm.kicad_mod',
  'lqfp-48':      'Package_QFP.pretty/LQFP-48_7x7mm_P0.5mm.kicad_mod',
  'lqfp-64':      'Package_QFP.pretty/LQFP-64_10x10mm_P0.5mm.kicad_mod',
  'lqfp-100':     'Package_QFP.pretty/LQFP-100_14x14mm_P0.5mm.kicad_mod',
  'bga-64':       'Package_BGA.pretty/BGA-64_9.0x9.0mm_Layout10x10_P0.8mm.kicad_mod',
  'bga-100':      'Package_BGA.pretty/BGA-100_11.0x11.0mm_Layout10x10_P1.0mm_Ball0.5mm_Pad0.4mm_NSMD.kicad_mod'
}

const STROKE = '#94a3b8'
const BODY_FILL = 'rgba(148,163,184,0.12)'
const PAD_FILL = 'rgba(148,163,184,0.30)'
const TARGET = 88 // 96 viewBox 内留边后的目标最大边长(px)

const n = v => Math.round(v * 100) / 100

// ===== KiCad .kicad_mod 解析（只取 F.Fab 本体图元 + 含铜焊盘）=====
function parseKicadMod(text) {
  const fab = []
  const pads = []

  for (const m of text.matchAll(/\(fp_line \(start ([-\d.]+) ([-\d.]+)\) \(end ([-\d.]+) ([-\d.]+)\)[^\n]*?\(layer "?F\.Fab"?\)/g)) {
    fab.push({ t: 'line', x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] })
  }
  for (const m of text.matchAll(/\(fp_rect \(start ([-\d.]+) ([-\d.]+)\) \(end ([-\d.]+) ([-\d.]+)\)[^\n]*?\(layer "?F\.Fab"?\)/g)) {
    fab.push({ t: 'rect', x: Math.min(+m[1], +m[3]), y: Math.min(+m[2], +m[4]), w: Math.abs(+m[3] - +m[1]), h: Math.abs(+m[4] - +m[2]) })
  }
  for (const m of text.matchAll(/\(fp_circle \(center ([-\d.]+) ([-\d.]+)\) \(end ([-\d.]+) ([-\d.]+)\)[^\n]*?\(layer "?F\.Fab"?\)/g)) {
    const r = Math.hypot(+m[3] - +m[1], +m[4] - +m[2])
    fab.push({ t: 'circle', cx: +m[1], cy: +m[2], r })
  }
  // 圆弧：start/mid/end 三点求圆心后采样为折线
  for (const m of text.matchAll(/\(fp_arc \(start ([-\d.]+) ([-\d.]+)\) \(mid ([-\d.]+) ([-\d.]+)\) \(end ([-\d.]+) ([-\d.]+)\)[^\n]*?\(layer "?F\.Fab"?\)/g)) {
    const pts = arcToPoints([+m[1], +m[2]], [+m[3], +m[4]], [+m[5], +m[6]])
    if (pts) fab.push({ t: 'poly', pts })
  }
  for (const m of text.matchAll(/\(fp_poly \(pts((?:\s*\(xy [-\d.]+ [-\d.]+\))+)\)[\s\S]*?\(layer "?F\.Fab"?\)/g)) {
    const pts = [...m[1].matchAll(/\(xy ([-\d.]+) ([-\d.]+)\)/g)].map(p => [+p[1], +p[2]])
    fab.push({ t: 'poly', pts })
  }

  for (const m of text.matchAll(/\(pad "?([^"\s]+)"? (smd|thru_hole) (rect|circle|oval|roundrect) \(at ([-\d.]+) ([-\d.]+)(?:\s+([-\d.]+))?\) \(size ([-\d.]+) ([-\d.]+)\)([^\n]*?)\(layers ([^)]*)\)/g)) {
    if (!/Cu/.test(m[10])) continue
    let w = +m[7], h = +m[8]
    const rot = +(m[6] ?? 0)
    if (rot % 180 !== 0) [w, h] = [h, w] // 90/270 旋转：宽高互换（斜放极少见，忽略）
    pads.push({ name: m[1], shape: m[3], x: +m[4], y: +m[5], w, h })
  }
  return { fab, pads }
}

/** 三点圆弧 → 折线采样（KiCad fp_arc 近似） */
function arcToPoints([sx, sy], [mx, my], [ex, ey]) {
  // 三点求外接圆圆心
  const ax = sx, ay = sy, bx = mx, by = my, cx = ex, cy = ey
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
  if (Math.abs(d) < 1e-9) return null
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d
  const r = Math.hypot(ax - ux, ay - uy)
  const a0 = Math.atan2(ay - uy, ax - ux)
  const a1 = Math.atan2(cy - uy, cx - ux)
  const am = Math.atan2(by - uy, bx - ux)
  // 判定扫掠方向（经过 mid 点）
  const norm = a => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  const ccw = norm(a1 - a0) > 0 ? (norm(am - a0) < norm(a1 - a0)) : (norm(a0 - a1) > norm(a0 - am))
  let sweep = ccw ? norm(a1 - a0) : -norm(a0 - a1)
  const segs = Math.max(6, Math.round(Math.abs(sweep) / (Math.PI / 12)))
  const pts = []
  for (let i = 0; i <= segs; i++) {
    const a = a0 + sweep * (i / segs)
    pts.push([ux + r * Math.cos(a), uy + r * Math.sin(a)])
  }
  return pts
}

// ===== 下载（带缓存）=====
async function fetchMod(rel) {
  const file = join(CACHE_DIR, rel.replaceAll('/', '__'))
  if (existsSync(file)) return readFileSync(file, 'utf-8')
  const res = await fetch(`${RAW_BASE}/${rel}`)
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${rel}`)
  const text = await res.text()
  writeFileSync(file, text, 'utf-8')
  return text
}

// ===== 渲染 =====
function bboxOf(p) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const eat = (x, y, m = 0) => {
    minX = Math.min(minX, x - m); minY = Math.min(minY, y - m)
    maxX = Math.max(maxX, x + m); maxY = Math.max(maxY, y + m)
  }
  for (const f of p.fab) {
    if (f.t === 'line') { eat(f.x1, f.y1); eat(f.x2, f.y2) }
    else if (f.t === 'rect') { eat(f.x, f.y); eat(f.x + f.w, f.y + f.h) }
    else if (f.t === 'circle') { eat(f.cx, f.cy, f.r) }
    else if (f.t === 'poly') { for (const [x, y] of f.pts) eat(x, y) }
  }
  for (const pad of p.pads) eat(pad.x, pad.y, Math.max(pad.w, pad.h) / 2)
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }
}

function render(p, S, boxW, boxH) {
  const cx = (p.bb.minX + p.bb.maxX) / 2
  const cy = (p.bb.minY + p.bb.maxY) / 2
  const X = x => n((x - cx) * S + boxW / 2)
  const Y = y => n((y - cy) * S + boxH / 2)
  let s = ''

  for (const f of p.fab) {
    if (f.t === 'line') s += `<line x1="${X(f.x1)}" y1="${Y(f.y1)}" x2="${X(f.x2)}" y2="${Y(f.y2)}"/>`
    else if (f.t === 'rect') s += `<rect x="${X(f.x)}" y="${Y(f.y)}" width="${n(f.w * S)}" height="${n(f.h * S)}" fill="${BODY_FILL}"/>`
    else if (f.t === 'circle') s += `<circle cx="${X(f.cx)}" cy="${Y(f.cy)}" r="${n(f.r * S)}"/>`
    else if (f.t === 'poly') s += `<polyline points="${f.pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ')}"/>`
  }
  for (const pad of p.pads) {
    const w = n(pad.w * S), h = n(pad.h * S), x = X(pad.x - pad.w / 2), y = Y(pad.y - pad.h / 2)
    if (pad.shape === 'circle') s += `<circle cx="${X(pad.x)}" cy="${Y(pad.y)}" r="${n(pad.w * S / 2)}" fill="${PAD_FILL}"/>`
    else if (pad.shape === 'oval' || pad.shape === 'roundrect') s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${n(Math.min(w, h) / 2.5)}" fill="${PAD_FILL}"/>`
    else s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${PAD_FILL}"/>`
  }
  // pin1 标记：本体框内、离 1 号焊盘最近的角上放实心圆点（业界标准俯视图画法）
  const pad1 = p.pads.find(pad => pad.name === '1')
  if (pad1) {
    // 本体范围 = F.Fab 图元的包围盒（不含焊盘）
    let fx0 = Infinity, fy0 = Infinity, fx1 = -Infinity, fy1 = -Infinity
    for (const f of p.fab) {
      const pts = f.t === 'line' ? [[f.x1, f.y1], [f.x2, f.y2]]
        : f.t === 'rect' ? [[f.x, f.y], [f.x + f.w, f.y + f.h]]
        : f.t === 'circle' ? [[f.cx - f.r, f.cy - f.r], [f.cx + f.r, f.cy + f.r]]
        : f.pts
      for (const [px, py] of pts) {
        fx0 = Math.min(fx0, px); fy0 = Math.min(fy0, py)
        fx1 = Math.max(fx1, px); fy1 = Math.max(fy1, py)
      }
    }
    if (isFinite(fx0)) {
      const inset = 0.55 // 距本体内缘 0.55mm
      const dotX = (pad1.x < (fx0 + fx1) / 2 ? fx0 + inset : fx1 - inset)
      const dotY = (pad1.y < (fy0 + fy1) / 2 ? fy0 + inset : fy1 - inset)
      const r = Math.max(0.9, Math.min(boxW, boxH) * 0.028)
      s += `<circle cx="${X(dotX)}" cy="${Y(dotY)}" r="${n(r)}" fill="${STROKE}" stroke="none"/>`
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(boxW)} ${n(boxH)}" fill="none" stroke="${STROKE}" stroke-width="${n(Math.max(0.9, TARGET * 0.014))}" stroke-linecap="round">${s}</svg>\n`
}

// ===== 主流程 =====
const parsed = {}
for (const [name, rel] of Object.entries(SPECS)) {
  parsed[name] = parseKicadMod(await fetchMod(rel))
  parsed[name].bb = bboxOf(parsed[name])
  if (!parsed[name].fab.length && !parsed[name].pads.length) {
    throw new Error(`解析为空: ${rel}`)
  }
}
// 全局统一比例尺：最大封装（DIP-16 ≈ 23mm 含针脚）占满 TARGET
let globalMax = 0
for (const p of Object.values(parsed)) globalMax = Math.max(globalMax, p.bb.w, p.bb.h)
const S = TARGET / globalMax
console.log(`统一比例尺 ${n(S)} px/mm（最大外形 ${n(globalMax)}mm）`)

// 旧版逐一手绘的 sop-8.svg 已被 sop-8-150mil/sop-8-208mil 取代，清掉避免残留
const legacy = join(OUT_DIR, 'sop-8.svg')
if (existsSync(legacy)) rmSync(legacy)

for (const [name, p] of Object.entries(parsed)) {
  const boxW = p.bb.w * S, boxH = p.bb.h * S
  writeFileSync(join(OUT_DIR, `${name}.svg`), render(p, S, boxW, boxH), 'utf-8')
}
console.log(`已生成 ${Object.keys(parsed).length} 个 KiCad 实测几何封装图 → ${OUT_DIR}`)
