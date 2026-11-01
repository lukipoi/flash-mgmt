/**
 * 封装 3D 图导入器（立创 3D 渲染图对接）
 * - 扫描 public/packages/3d/ 下用户丢入的图片（png/webp/jpg/jpeg）
 * - 文件名按 规范名/别名 模糊匹配 PACKAGES 条目（忽略大小写、空格、连字符、下划线）
 * - 匹配成功则把 utils/packages.ts 对应条目的 image 字段改写为 /packages/3d/<文件名>
 * - 幂等：可反复运行；未匹配的文件会列出来提示改名
 * 用法：node scripts/import-package-3d.mjs（干跑预览加 --dry）
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PACKAGES } from '../utils/packages.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const IMG_DIR = join(ROOT, 'public', 'packages', '3d')
const PKG_TS = join(ROOT, 'utils', 'packages.ts')
const DRY = process.argv.includes('--dry')

const EXTS = new Set(['png', 'webp', 'jpg', 'jpeg'])

/** 归一化匹配 key：小写，去掉空格/连字符/下划线/mil 后缀差异保留数字 */
const keyOf = s => s.toLowerCase().replace(/[\s\-_]+/g, '')

// 预建 匹配key → 规范名 索引（规范名 + 全部别名）
const LOOKUP = new Map()
for (const p of PACKAGES) {
  LOOKUP.set(keyOf(p.name), p.name)
  for (const a of p.aliases) {
    const k = keyOf(a)
    if (!LOOKUP.has(k)) LOOKUP.set(k, p.name)
  }
}

const files = readdirSync(IMG_DIR).filter(f => EXTS.has(f.split('.').pop()?.toLowerCase() ?? ''))
if (!files.length) {
  console.log(`${IMG_DIR} 下没有图片文件`)
  process.exit(0)
}

// 逐文件匹配：优先整词（去扩展名），失败则试"包含封装名"匹配
const plan = [] // { file, pkgName }
const unmatched = []
for (const f of files) {
  const stem = f.replace(/\.[^.]+$/, '')
  let pkg = LOOKUP.get(keyOf(stem))
  if (!pkg) {
    // 文件名里包含封装 key 即认为匹配（取最长的 key 防 sop8 抢 sop8-208mil）
    const hits = [...LOOKUP.keys()].filter(k => keyOf(stem).includes(k)).sort((a, b) => b.length - a.length)
    if (hits.length) pkg = LOOKUP.get(hits[0])
  }
  if (pkg) plan.push({ file: f, pkgName: pkg })
  else unmatched.push(f)
}

if (unmatched.length) {
  console.log('以下文件名没认出封装，请改名（带封装名即可，如 "QFN-32.png"）：')
  for (const f of unmatched) console.log(`  - ${f}`)
}
if (!plan.length) process.exit(0)

// 改写 utils/packages.ts 的 image 字段（按规范名定位条目行）
let src = readFileSync(PKG_TS, 'utf-8')
for (const { file, pkgName } of plan) {
  const newPath = `/packages/3d/${file}`
  const re = new RegExp(`(\\{ name: '${pkgName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}',\\s*image: ')[^']*(')`)
  if (!re.test(src)) {
    console.log(`!! packages.ts 里没找到 ${pkgName} 的 image 字段，跳过`)
    continue
  }
  src = src.replace(re, `$1${newPath}$2`)
  console.log(`${DRY ? '[预览] ' : ''}${pkgName} → ${newPath}`)
}
if (!DRY) {
  writeFileSync(PKG_TS, src, 'utf-8')
  console.log(`已更新 ${PKG_TS}`)
} else {
  console.log('（干跑模式，未写入；去掉 --dry 正式执行）')
}
