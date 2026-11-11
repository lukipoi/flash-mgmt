/**
 * patch_jpeg_partial.mjs —— 给 vendor 的 jpeg-js decoder 打"部分解码"补丁。
 * 原版（Apache 2.0, notmasteryet）：熵数据耗尽即抛错 → 魔改后：
 *   提前跳出 MCU 循环，输出高度截断到已完整解码的像素行，image.partial=true。
 * 锚点全部强制校验，命中数不对即报错退出。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const FILE = 'server/lib/jpeg-partial.js'
let src = readFileSync(FILE, 'utf8')

const patches = [
  // P1: 模块级状态（JpegImage 闭包与顶层 decode() 共享）
  ['var JpegImage = (function jpegImage() {',
   `// [jpeg-partial] partial-decoding state (shared between JpegImage closure and top-level decode())
var __partialRows = 0;    // fully-decoded pixel rows (0 = complete image / unused)
var __partialHit = false; // entropy data ran out mid-scan

var JpegImage = (function jpegImage() {`],

  // P2: MCU 循环头 - 数据耗尽检测（每轮 reset-interval 检查一次）
  [`    var h, v;
    while (mcu < mcuExpected) {
      // reset interval stuff`,
   `    var h, v;
    var outOfData = false; // [jpeg-partial]
    while (mcu < mcuExpected && !outOfData) {
      if (offset >= data.length - 2) { outOfData = true; break; } // [jpeg-partial]
      // reset interval stuff`],

  // P3: 单组件分支
  [`        for (n = 0; n < resetInterval; n++) {
          decodeBlock(component, decodeFn, mcu);
          mcu++;
        }
      } else {`,
   `        for (n = 0; n < resetInterval; n++) {
          if (offset >= data.length - 2) { outOfData = true; break; } // [jpeg-partial]
          decodeBlock(component, decodeFn, mcu);
          mcu++;
        }
        if (outOfData) break; // [jpeg-partial]
      } else {`],

  // P4: 多组件分支
  [`        for (n = 0; n < resetInterval; n++) {
          for (i = 0; i < componentsLength; i++) {`,
   `        for (n = 0; n < resetInterval; n++) {
          if (offset >= data.length - 2) { outOfData = true; break; } // [jpeg-partial]
          for (i = 0; i < componentsLength; i++) {`],

  // P5: 多组件分支尾
  [`          // If we've reached our expected MCU's, stop decoding
          if (mcu === mcuExpected) break;
        }
      }`,
   `          // If we've reached our expected MCU's, stop decoding
          if (mcu === mcuExpected) break;
        }
        if (outOfData) break; // [jpeg-partial]
      }`],

  // P6: 跳过 trailing-bytes 扫描与 marker 处理
  [`      if (mcu === mcuExpected) {
        // Skip trailing bytes at the end of the scan`,
   `      if (outOfData) break; // [jpeg-partial] entropy exhausted, skip trailing/marker handling

      if (mcu === mcuExpected) {
        // Skip trailing bytes at the end of the scan`],

  // P7: decodeScan 返回前记录已解码行数
  [`      else
        break;
    }

    return offset - startOffset;
  }`,
   `      else
        break;
    }

    // [jpeg-partial] record how many pixel rows are fully decoded
    if (outOfData) {
      __partialHit = true;
      __partialRows = Math.ceil(mcu / mcusPerLine) * 8 * maxV;
    }
    return offset - startOffset;
  }`],

  // P8: parse 主循环守卫
  [`      while (fileMarker != 0xFFD9) { // EOI (End of image)`,
   `      while (fileMarker != 0xFFD9 && !__partialHit) { // EOI (End of image) [jpeg-partial]`],

  // P9: SOS case - 提前终止 marker 链
  [`            var processed = decodeScan(data, offset,
              frame, components, resetInterval,
              spectralStart, spectralEnd,
              successiveApproximation >> 4, successiveApproximation & 15, this.opts);
            offset += processed;
            break;`,
   `            var processed = decodeScan(data, offset,
              frame, components, resetInterval,
              spectralStart, spectralEnd,
              successiveApproximation >> 4, successiveApproximation & 15, this.opts);
            offset += processed;
            if (__partialHit) break; // [jpeg-partial] entropy exhausted
            break;`],

  // P10: switch 之后的 marker 读取守卫
  [`        fileMarker = readUint16();
      }
      if (frames.length != 1)`,
   `        if (__partialHit) break; // [jpeg-partial] entropy exhausted
        fileMarker = readUint16();
      }
      if (frames.length != 1)`],

  // P11: decode() 重置状态 + 输出高度截断
  [`  var channels = (opts.formatAsRGBA) ? 4 : 3;
  var bytesNeeded = decoder.width * decoder.height * channels;`,
   `  // [jpeg-partial] reset state per call
  __partialRows = 0;
  __partialHit = false;

  var channels = (opts.formatAsRGBA) ? 4 : 3;
  // [jpeg-partial] truncate output height to fully-decoded rows
  var outWidth = decoder.width;
  var outHeight = decoder.height;
  if (__partialHit && __partialRows > 0 && __partialRows < outHeight) {
    outHeight = __partialRows;
  }
  var bytesNeeded = outWidth * outHeight * channels;`],

  // P12: image 对象（截断尺寸 + partial 标志）
  [`    var image = {
      width: decoder.width,
      height: decoder.height,
      exifBuffer: decoder.exifBuffer,`,
   `    var image = {
      width: outWidth,
      height: outHeight,
      partial: __partialHit && outHeight < decoder.height,
      fullHeight: decoder.height,
      exifBuffer: decoder.exifBuffer,`],
]

let failed = 0
for (const [i, [from, to]] of patches.entries()) {
  if (!src.includes(from)) {
    console.error(`PATCH ${i + 1}/${patches.length} 锚点未命中!`)
    failed++
    continue
  }
  if (src.includes(to)) {
    console.error(`PATCH ${i + 1}/${patches.length} 疑似已打过，跳过`)
    continue
  }
  src = src.replace(from, to)
  console.log(`PATCH ${i + 1}/${patches.length} ok`)
}

if (failed) {
  console.error(`${failed} 个补丁失败，文件未写入`)
  process.exit(1)
}
writeFileSync(FILE, src)
console.log('all patches applied ->', FILE)
