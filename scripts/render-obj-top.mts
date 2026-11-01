// @ts-nocheck 构建脚本：Node 类型剥离要求 import 带 .ts 后缀，与 vue-tsc 规则冲突，整体豁免
/**
 * 封装 3D 模型 → 顶视图 SVG 离线渲染器
 * - 扫描 public/packages/models/*.obj（立创下载的模型，文件名带封装名即可）
 * - 正交正俯视（标准封装外形图视角，不偏航/不俯仰），按材质 Kd 平涂
 * - 输出 public/packages/3d/<规范名小写连字符>.svg
 * - 同步更新 utils/packages.ts 对应条目的 image / model 字段
 * 用法：node scripts/render-obj-top.mts（--dry 干跑预览）
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseObj, canonicalVerts } from '../utils/objModel.ts'
import { PACKAGES } from '../utils/packages.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MODEL_DIR = join(ROOT, 'public', 'packages', 'models')
const OUT_DIR = join(ROOT, 'public', 'packages', '3d')
const PKG_TS = join(ROOT, 'utils', 'packages.ts')
const DRY = process.argv.includes('--dry')

// 正俯视：屏幕 X/Y 直接取封装平面坐标（canonical 已保证 +y 朝上），深度用高度
const AMBIENT = 0.82, DIFFUSE = 0.18

/** 归一化匹配 key：小写去空格/连字符/下划线 */
const keyOf = (s) => s.toLowerCase().replace(/[\s\-_]+/g, '')

// 匹配key → 规范名（规范名 + 别名）
const LOOKUP = new Map<string, string>()
for (const p of PACKAGES) {
  LOOKUP.set(keyOf(p.name), p.name)
  for (const a of p.aliases) {
    const k = keyOf(a)
    if (!LOOKUP.has(k)) LOOKUP.set(k, p.name)
  }
}

const files = readdirSync(MODEL_DIR).filter(f => f.toLowerCase().endsWith('.obj'))
if (!files.length) {
  console.log(`${MODEL_DIR} 下没有 .obj 模型文件`)
  process.exit(0)
}

mkdirSync(OUT_DIR, { recursive: true })
let src = readFileSync(PKG_TS, 'utf-8')
let changed = false

for (const f of files) {
  const stem = f.replace(/\.obj$/i, '')
  let pkgName = LOOKUP.get(keyOf(stem))
  if (!pkgName) {
    // 文件名包含封装 key 即匹配（取最长 key，防 sop8 抢 sop8-208mil）
    const hits = [...LOOKUP.keys()].filter(k => keyOf(stem).includes(k)).sort((a, b) => b.length - a.length)
    if (hits.length) pkgName = LOOKUP.get(hits[0]!)
  }
  if (!pkgName) {
    console.log(`未识别封装: ${f}（文件名里带封装名即可，如 "QFN-32.obj"）`)
    continue
  }

  const model = parseObj(readFileSync(join(MODEL_DIR, f), 'utf-8'))
  const { cv } = canonicalVerts(model)
  const n = cv.length / 3

  // 正交正俯视投影：屏幕 (x, y) = 平面 (x, y)，深度 = 高度
  const px = new Float64Array(n), py = new Float64Array(n), pz = new Float64Array(n)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i < n; i++) {
    px[i] = cv[i * 3]!
    py[i] = cv[i * 3 + 1]!
    pz[i] = cv[i * 3 + 2]!
    minX = Math.min(minX, px[i]!); maxX = Math.max(maxX, px[i]!)
    minY = Math.min(minY, py[i]!); maxY = Math.max(maxY, py[i]!)
  }

  // 画家算法：按面片平均深度从远到近排序
  const order = model.tris
    .map((t, i) => ({ i, d: pz[t.a]! + pz[t.b]! + pz[t.c]! }))
    .sort((a, b) => a.d - b.d)

  const span = Math.max(maxX - minX, maxY - minY)
  const sw = span / 400 // 细描边封 AA 接缝
  const parts: string[] = []
  for (const { i } of order) {
    const t = model.tris[i]!
    const ax = cv[t.a * 3]!, ay = cv[t.a * 3 + 1]!, az = cv[t.a * 3 + 2]!
    const bx = cv[t.b * 3]!, by = cv[t.b * 3 + 1]!, bz = cv[t.b * 3 + 2]!
    const cxx = cv[t.c * 3]!, cyy = cv[t.c * 3 + 1]!, czz = cv[t.c * 3 + 2]!
    // 法线 = (b-a)×(c-a)，再转到相机空间
    let nx = (by - ay) * (czz - az) - (bz - az) * (cyy - ay)
    let ny = (bz - az) * (cxx - ax) - (bx - ax) * (czz - az)
    let nz = (bx - ax) * (cyy - ay) - (by - ay) * (cxx - ax)
    const nl = Math.hypot(nx, ny, nz) || 1
    nx /= nl; ny /= nl; nz /= nl
    // 双面光照：正俯视下只按顶面朝上的程度压暗侧面/底面
    const bright = AMBIENT + DIFFUSE * Math.abs(nz)
    const r = Math.min(255, Math.round(t.color[0] * bright * 255))
    const g = Math.min(255, Math.round(t.color[1] * bright * 255))
    const b = Math.min(255, Math.round(t.color[2] * bright * 255))
    parts.push(
      `<polygon points="${px[t.a]!.toFixed(3)},${(-py[t.a]!).toFixed(3)} ${px[t.b]!.toFixed(3)},${(-py[t.b]!).toFixed(3)} ${px[t.c]!.toFixed(3)},${(-py[t.c]!).toFixed(3)}" fill="rgb(${r},${g},${b})" stroke="rgb(${r},${g},${b})" stroke-width="${sw.toFixed(3)}"/>`
    )
  }

  const margin = span * 0.06
  const vbX = minX - margin, vbY = -(maxY + margin)
  const vbW = maxX - minX + margin * 2, vbH = maxY - minY + margin * 2
  const slug = pkgName.toLowerCase().replace(/\s+/g, '-')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX.toFixed(3)} ${vbY.toFixed(3)} ${vbW.toFixed(3)} ${vbH.toFixed(3)}">\n${parts.join('\n')}\n</svg>\n`
  const outRel = `/packages/3d/${slug}.svg`
  const modelRel = `/packages/models/${f}`

  if (!DRY) writeFileSync(join(OUT_DIR, `${slug}.svg`), svg)
  console.log(`${DRY ? '[预览] ' : ''}${pkgName} ← ${f}（${model.tris.length} 三角面，${(svg.length / 1024).toFixed(0)}KB）→ ${outRel}`)

  // 更新 packages.ts：image 指向顶视图，model 指向 OBJ（已存在则替换路径）
  const esc = pkgName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const imgRe = new RegExp(`(\\{ name: '${esc}',\\s*image: ')[^']*(')`)
  if (!imgRe.test(src)) {
    console.log(`!! packages.ts 里没找到 ${pkgName} 的 image 字段，跳过字段更新`)
    continue
  }
  src = src.replace(imgRe, `$1${outRel}$2`)
  const entryRe = new RegExp(`(\\{ name: '${esc}',[^}]*)`)
  const entry = src.match(entryRe)?.[0] ?? ''
  if (entry.includes('model:')) {
    src = src.replace(new RegExp(`(\\{ name: '${esc}',[^}]*?model: ')[^']*(')`), `$1${modelRel}$2`)
  } else {
    src = src.replace(new RegExp(`(\\{ name: '${esc}', image: '[^']*')`), `$1, model: '${modelRel}'`)
  }
  changed = true
}

if (changed && !DRY) {
  writeFileSync(PKG_TS, src, 'utf-8')
  console.log(`已更新 ${PKG_TS}`)
} else if (DRY) {
  console.log('（干跑模式，未写入；去掉 --dry 正式执行）')
}
