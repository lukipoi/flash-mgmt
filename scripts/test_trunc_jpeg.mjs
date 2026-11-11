/**
 * 纯 Node 截断 JPEG 解码实验：全图按比例截断 + 补 EOI(FFD9)，
 * jpeg-js 解码 → @zxing/library 解码，验证"边收边解"在 Node 侧可行。
 * 用真实图 escl_stream_result.jpg（GD25Q64 #113 标签，码在中下部）。
 */
import { readFileSync } from 'node:fs'
import jpeg from 'jpeg-js'
import zxing from '@zxing/library'
const { BarcodeFormat, BinaryBitmap, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } = zxing

const full = readFileSync('server/python/escl_stream_result.jpg')
console.log('full image:', full.length, 'bytes')

const reader = new MultiFormatReader()
const hints = new Map()
hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.EAN_13])
reader.setHints(hints)

function tryDecode(buf, label) {
  try {
    const raw = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024 })
    const { data, width, height } = raw
    // RGBA → 灰度
    const lum = new Uint8ClampedArray(width * height)
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      lum[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000
    }
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, width, height)))
    try {
      const res = reader.decode(bitmap)
      console.log(`${label}: HIT "${res.getText()}" (${width}x${height})`)
      return true
    } catch {
      console.log(`${label}: no barcode (${width}x${height})`)
      return false
    }
  } catch (e) {
    console.log(`${label}: decode failed - ${e.message?.slice(0, 80)}`)
    return false
  }
}

// 不补 EOI 直接截断
tryDecode(full.subarray(0, 400000), '40% raw-truncated')
// 补 EOI 各比例
for (const ratio of [0.15, 0.20, 0.25, 0.30, 0.40, 0.50, 0.60, 1.0]) {
  const n = Math.floor(full.length * ratio) & ~0xF
  const buf = Buffer.concat([full.subarray(0, n), Buffer.from([0xFF, 0xD9])])
  tryDecode(buf, `${(ratio * 100).toFixed(0)}% +EOI (${n}B)`)
}
