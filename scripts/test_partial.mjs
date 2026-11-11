/**
 * 截断部分解码实验：jpeg-partial（魔改 jpeg-js）+ zxing-wasm
 * 验证「流式中途解码」在 Node 侧可行——拿全图按比例截断模拟渐进流。
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const require = createRequire(import.meta.url)
const jpeg = require('../server/lib/jpeg-partial.cjs')
const zxing = await import('zxing-wasm')

const full = readFileSync(new URL('../scripts/sample.jpg', import.meta.url))
console.log('full:', full.length, 'B')

async function hit(buf, label) {
  const t0 = Date.now()
  try {
    const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024 })
    const res = await zxing.readBarcodes(
      { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height },
      { tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true })
    console.log(`${label}: decoded ${img.width}x${img.height}` +
      (img.partial ? ` PARTIAL(full=${img.fullHeight})` : '') +
      ` (${Date.now() - t0}ms) -> ` +
      (res.length ? `HIT "${res[0].text}"` : 'no barcode'))
  } catch (e) {
    console.log(`${label}: failed - ${String(e.message).slice(0, 80)} (${Date.now() - t0}ms)`)
  }
}

await hit(full, '100% full')
for (const ratio of [0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.8]) {
  const n = Math.floor(full.length * ratio) & ~0xF
  await hit(full.subarray(0, n), `${(ratio * 100).toFixed(0)}% (${n}B)`)
}
