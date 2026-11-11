/**
 * Node 版 eSCL 流式早停实验（不走 Python！）
 * fetch POST ScanJobs → GET NextDocument 流式 → 魔改 jpeg-partial 每 0.4s
 * 部分解码 → zxing-wasm 解码 → 命中立即 DELETE 停机。
 *
 * 跑前：玻璃上放一张带二维码的标签。
 */
import fs from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const jpeg = require('../server/lib/jpeg-partial.cjs')
const zxing = await import('zxing-wasm')

const BASE = 'http://192.168.1.208/eSCL'
const HP = 'http://schemas.hp.com/imaging/escl/2011/05/03'
const PWG = 'http://www.pwg.org/schemas/2010/12/sm'
const W = 2550, H = 3508, DPI = 200

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:scan="${HP}" xmlns:pwg="${PWG}">
  <pwg:Version>2.5</pwg:Version>
  <scan:Intent>Photo</scan:Intent>
  <pwg:ScanRegions>
    <pwg:ScanRegion>
      <pwg:Height>${H}</pwg:Height>
      <pwg:Width>${W}</pwg:Width>
      <pwg:XOffset>0</pwg:XOffset>
      <pwg:YOffset>0</pwg:YOffset>
    </pwg:ScanRegion>
  </pwg:ScanRegions>
  <pwg:InputSource>Platen</pwg:InputSource>
  <scan:DocumentFormatExt>image/jpeg</scan:DocumentFormatExt>
  <scan:XResolution>${DPI}</scan:XResolution>
  <scan:YResolution>${DPI}</scan:YResolution>
  <scan:ColorMode>Grayscale8</scan:ColorMode>
  <scan:CompressionFactor>85</scan:CompressionFactor>
</scan:ScanSettings>`

let lastTry = 0
let tries = 0

// 部分解码：灰度单通道（200dpi 源 + zxing 灰度输入，wasm 内存 ~16MB/次可控；
// jpeg-js 的 V8 堆压力靠 800ms 节流 + 低 DPI 压下来）
async function tryDecode(buf) {
  try {
    const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024, formatAsRGBA: false })
    const { data, width, height } = img  // formatAsRGBA:false → RGB 3 通道
    const out = new Uint8ClampedArray(width * height * 4)
    for (let i = 0, j = 0; j < out.length; i += 3, j += 4) {
      const g = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000
      out[j] = out[j + 1] = out[j + 2] = g
      out[j + 3] = 255
    }
    const res = await zxing.readBarcodes(
      { data: out, width, height },
      { tryHarder: true, tryDownscale: true })
    return res.length ? res.map(r => r.text) : null
  } catch {
    return null  // JPEG 头未收齐 / 中间态，继续等
  }
}

const t0 = Date.now()
const ts = () => `[${((Date.now() - t0) / 1000).toFixed(1)}s]`

// POST 用 node:http 原生实现（undici 会把头名小写化，HP 老固件疑似大小写敏感 → 400）
function postScanJobs(xml) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE}/ScanJobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml', 'Content-Length': Buffer.byteLength(xml) },
    }, (res) => resolve(res))
    req.on('error', reject)
    req.end(xml)
  })
}

const r0 = await postScanJobs(XML)
if (r0.statusCode !== 200 && r0.statusCode !== 201) {
  console.error('POST ScanJobs failed:', r0.statusCode)
  process.exit(1)
}
const job = r0.headers.location
r0.resume()
console.log(`${ts()} POST ${r0.statusCode} job=${job}`)

const resp = await fetch(`${job}/NextDocument`)
console.log(`${ts()} GET ${resp.status} ${resp.headers.get('content-type')}`)

const buf = Buffer.alloc(0)
const chunks = []
let hit = null
const reader = resp.body.getReader()
while (true) {
  const { done, value } = reader.read()
  if (done) { console.log(`${ts()} 流结束，共收 ${chunks.reduce((s, c) => s + (c?.length || 0), 0)}B`); break }
  if (!value || !value.length) continue
  chunks.push(value)
  const size = chunks.reduce((s, c) => s + (c?.length || 0), 0)
  if (Date.now() - lastTry >= 800) {
    lastTry = Date.now()
    tries++
    const merged = Buffer.concat(chunks)
    const texts = await tryDecode(merged)
    if (texts) {
      hit = texts
      console.log(`${ts()} 命中！已收 ${merged.length}B（第 ${tries} 次尝试解码）`)
      break
    }
  }
}

// 停机 + 删 job
try { await fetch(job, { method: 'DELETE' }); console.log(`${ts()} job deleted`) }
catch (e) { console.log(`${ts()} delete: ${e.message?.slice(0, 60)}（job 可能已自动清）`) }

const merged = Buffer.concat(chunks)
fs.writeFileSync('scripts/escl_node_result.jpg', merged)

if (hit) {
  console.log(`RESULT: 命中 ${JSON.stringify(hit)} | 总耗时 ${(Date.now() - t0) / 1000}s | 只收 ${merged.length}B`)
} else {
  const texts = await tryDecode(merged)
  console.log(`RESULT: 流式未早停，整面兜底解码: ${JSON.stringify(texts)} | 总耗时 ${(Date.now() - t0) / 1000}s | ${merged.length}B`)
}
