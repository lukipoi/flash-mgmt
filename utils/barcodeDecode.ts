/**
 * 条码解码（ZXing 底层 API）
 * - createBarcodeDecoder：可复用解码器，reader/画布只建一次，适合实时取景逐帧解码
 * - decodeImageBarcode：一次性照片解码（拍照/相册场景）
 * 不依赖 getUserMedia，解码本身在 http 环境可用（getUserMedia 才需要 https）
 */

/** RGBA → 灰度 buffer（RGBLuminanceSource 只接受 width*height 灰度数组） */
function toLum(img: ImageData): Uint8ClampedArray {
  const { data, width, height } = img
  const out = new Uint8ClampedArray(width * height)
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] = (306 * data[i] + 601 * data[i + 1] + 117 * data[i + 2] + 0x200) >> 10
  }
  return out
}

/** 灰度 3x3 锐化卷积（中心 5，邻域 -1），Uint8ClampedArray 自动钳位 */
function sharpenLum(lum: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(lum)
  for (let y = 1; y < h - 1; y++) {
    const row = y * w
    for (let x = 1; x < w - 1; x++) {
      const i = row + x
      out[i] = 5 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - w] - lum[i + w]
    }
  }
  return out
}

export interface BarcodeDecoder {
  /** 解码一帧；识别成功返回文本，未识别返回 null */
  decodeFrame(source: CanvasImageSource): string | null
}

/**
 * 创建可复用解码器
 * @param maxDim 长边缩放上限：照片 1600；实时取景 1280（帧率高）
 */
export async function createBarcodeDecoder(maxDim = 1600): Promise<BarcodeDecoder> {
  const { MultiFormatReader, BinaryBitmap, HybridBinarizer, GlobalHistogramBinarizer, RGBLuminanceSource, DecodeHintType, BarcodeFormat } = await import('@zxing/library')

  const hints = new Map()
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.ITF,
    BarcodeFormat.QR_CODE,
    BarcodeFormat.DATA_MATRIX
  ])
  hints.set(DecodeHintType.TRY_HARDER, true)
  const reader = new MultiFormatReader()
  reader.setHints(hints)

  const binarizers = [HybridBinarizer, GlobalHistogramBinarizer] as Array<any>

  /** 同一灰度 buffer 依次用两种二值化器尝试解码 */
  const tryDecode = (lum: Uint8ClampedArray, w: number, h: number): string | null => {
    const src = new RGBLuminanceSource(lum, w, h)
    for (const B of binarizers) {
      try {
        const result = reader.decodeWithState(new BinaryBitmap(new B(src)))
        return result.getText()
      } catch { /* NotFound → 换下一个二值化器 */ }
    }
    return null
  }

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!

  return {
    decodeFrame(source) {
      // 源尺寸（ImageBitmap/HTMLImageElement 均有，HTMLVideoElement 用 videoWidth）
      const sw = (source as HTMLVideoElement).videoWidth || (source as HTMLImageElement).naturalWidth || (source as ImageBitmap).width
      const sh = (source as HTMLVideoElement).videoHeight || (source as HTMLImageElement).naturalHeight || (source as ImageBitmap).height
      if (!sw || !sh) return null

      // 缩放到 maxDim（小图放大到 2x 有助于远处小条码）
      const scale = sw > maxDim ? maxDim / sw : (sw < maxDim / 2 ? Math.min(2, maxDim / sw) : 1)
      const cw = Math.round(sw * scale)
      const ch = Math.round(sh * scale)
      if (canvas.width !== cw) canvas.width = cw
      if (canvas.height !== ch) canvas.height = ch
      ctx.drawImage(source, 0, 0, cw, ch)

      const lum = toLum(ctx.getImageData(0, 0, cw, ch))
      // 四路尝试：原始×{Hybrid, Global} + 锐化×{Hybrid, Global}
      let text = tryDecode(lum, cw, ch)
      if (!text) text = tryDecode(sharpenLum(lum, cw, ch), cw, ch)
      return text
    }
  }
}

/** 一次性照片解码（内部同样走四路尝试） */
export async function decodeImageBarcode(
  source: CanvasImageSource,
  maxDim = 1600
): Promise<DecodeImageResult | null> {
  const decoder = await createBarcodeDecoder(maxDim)
  const text = decoder.decodeFrame(source)
  return text ? { text } : null
}

export interface DecodeImageResult {
  text: string
}
