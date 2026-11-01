<script setup lang="ts">
/**
 * 摄像头扫码弹窗（ZXing 底层 API）
 * 每帧四路尝试：原始灰度×{Hybrid, Global} 二值化 + 锐化灰度×{Hybrid, Global} 二值化
 * - 原始帧保证基础识别率（旧版路径）
 * - 锐化帧针对笔记本摄像头虚焦条码做边缘补偿
 * - GlobalHistogramBinarizer 对低清一维条码常比 HybridBinarizer 更准
 * - setHints 一次 + decodeWithState：ZXing 官方连续扫描用法，避免每帧重建 reader 列表
 * 灰度公式与 ZXing 内置一致：(306R + 601G + 117B + 0x200) >> 10
 * 仅在客户端运行；摄像头需要安全上下文（localhost 或 https）
 */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  scanned: [value: string]
}>()

const videoRef = ref<HTMLVideoElement | null>(null)
const errorMsg = ref<string | null>(null)
const starting = ref(false)

let stream: MediaStream | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let stopped = false

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

async function startScan() {
  if (!import.meta.client || !videoRef.value) return
  errorMsg.value = null
  starting.value = true
  try {
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

    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
    })
    const video = videoRef.value
    video.srcObject = stream
    await video.play()
    starting.value = false

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!

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

    // 链式调度：解码完成后 ~100ms 再抓下一帧，避免重帧堆积阻塞 UI
    const tick = () => {
      if (stopped) return
      let found: string | null = null
      if (video.videoWidth && video.videoHeight) {
        const scale = Math.min(1, 1280 / video.videoWidth)
        const cw = Math.round(video.videoWidth * scale)
        const ch = Math.round(video.videoHeight * scale)
        if (canvas.width !== cw) canvas.width = cw
        if (canvas.height !== ch) canvas.height = ch
        ctx.drawImage(video, 0, 0, cw, ch)
        const lum = toLum(ctx.getImageData(0, 0, cw, ch))
        found = tryDecode(lum, cw, ch)
        if (!found) found = tryDecode(sharpenLum(lum, cw, ch), cw, ch)
      }
      if (found) {
        emit('scanned', found)
        close()
        return
      }
      timer = setTimeout(tick, 100)
    }
    stopped = false
    timer = setTimeout(tick, 300)
  } catch (e: any) {
    errorMsg.value = e?.name === 'NotAllowedError'
      ? '摄像头权限被拒绝，请在浏览器地址栏允许摄像头访问后重试'
      : e?.name === 'NotFoundError'
        ? '未检测到摄像头设备'
        : `启动摄像头失败: ${e?.message || e}`
    starting.value = false
  }
}

function stopScan() {
  stopped = true
  if (timer) { clearTimeout(timer); timer = null }
  if (stream) {
    for (const t of stream.getTracks()) t.stop()
    stream = null
  }
  if (videoRef.value) videoRef.value.srcObject = null
}

function close() {
  stopScan()
  emit('update:open', false)
}

watch(() => props.open, async (val) => {
  if (val) {
    await nextTick()
    startScan()
  } else {
    stopScan()
  }
})

onBeforeUnmount(stopScan)
</script>

<template>
  <UModal :open="open" title="扫描条码" @update:open="(v: boolean) => { if (!v) close() }">
    <template #body>
      <div class="space-y-3">
        <div class="overflow-hidden rounded-md bg-surface-sunken ring-1 ring-line">
          <video ref="videoRef" class="aspect-video w-full object-cover" muted playsinline />
        </div>
        <div v-if="errorMsg" class="rounded-md bg-alert-500/10 p-3 text-sm text-alert-300 ring-1 ring-alert-500/20">
          {{ errorMsg }}
        </div>
        <p v-else class="text-xs text-ink-tertiary">
          {{ starting ? '正在启动摄像头...' : '将条码横满画面并离近一些，识别成功后自动填入并关闭' }}
        </p>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end">
        <UButton color="neutral" variant="ghost" @click="close">
          关闭
        </UButton>
      </div>
    </template>
  </UModal>
</template>
