<script setup lang="ts">
/**
 * 手机端扫码页
 * 配对码从 URL ?pair= 进入（电脑端二维码/链接携带），也可手输
 * 两种模式：
 * - 实时取景（需 https/localhost，http 下浏览器禁用 getUserMedia）：连续识别自动回传
 * - 拍照/相册（任何环境可用）：拍照 → 本地 ZXing 解码 → 回传电脑
 */
import { createBarcodeDecoder, decodeImageBarcode } from '~~/utils/barcodeDecode'

definePageMeta({
  layout: false,
  title: '手机扫码'
})

const route = useRoute()
const pair = ref(String(route.query.pair || ''))
const rememberPair = ref(true)

onMounted(() => {
  const saved = localStorage.getItem('scanPair')
  if (pair.value) {
    if (rememberPair.value) localStorage.setItem('scanPair', pair.value)
  } else if (saved) {
    pair.value = saved
  }
  liveSupported.value = !!navigator.mediaDevices?.getUserMedia
})

// ---------- 实时取景模式 ----------
const liveSupported = ref(false)
const liveOn = ref(false)
const liveStarting = ref(false)
const liveError = ref<string | null>(null)
const videoRef = ref<HTMLVideoElement | null>(null)

let liveStream: MediaStream | null = null
let liveTimer: ReturnType<typeof setTimeout> | null = null
let liveDecoder: Awaited<ReturnType<typeof createBarcodeDecoder>> | null = null
let lastPushed = ''
let lastPushAt = 0

async function startLive() {
  if (!pair.value.trim()) {
    liveError.value = '请先填写电脑端显示的设备码'
    return
  }
  liveError.value = null
  liveStarting.value = true
  try {
    liveDecoder = await createBarcodeDecoder(1280)
    liveStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
    })
    const video = videoRef.value!
    video.srcObject = liveStream
    await video.play()
    liveOn.value = true
    liveStarting.value = false

    // 链式调度逐帧解码；同码 2s 内去重
    const tick = () => {
      if (!liveOn.value) return
      let text: string | null = null
      if (videoRef.value?.videoWidth) text = liveDecoder?.decodeFrame(videoRef.value) || null
      const now = Date.now()
      if (text && !(text === lastPushed && now - lastPushAt < 2000)) {
        lastPushed = text
        lastPushAt = now
        pushText(text)
      }
      liveTimer = setTimeout(tick, 120)
    }
    liveTimer = setTimeout(tick, 300)
  } catch (e: any) {
    liveError.value = e?.name === 'NotAllowedError'
      ? '摄像头权限被拒绝'
      : `实时模式启动失败: ${e?.message || e}`
    liveStarting.value = false
    stopLive()
  }
}

function stopLive() {
  liveOn.value = false
  if (liveTimer) { clearTimeout(liveTimer); liveTimer = null }
  if (liveStream) {
    for (const t of liveStream.getTracks()) t.stop()
    liveStream = null
  }
  if (videoRef.value) videoRef.value.srcObject = null
}

async function pushText(text: string) {
  lastResult.value = text
  history.value.unshift(text)
  try {
    await $fetch('/api/scan/push', {
      method: 'POST',
      body: { pair: pair.value.trim(), text }
    })
  } catch (err: any) {
    lastError.value = err?.statusMessage || err?.data?.statusMessage || err?.message || '回传失败'
  }
}

// ---------- 拍照 / 相册模式 ----------
const fileInput = ref<HTMLInputElement | null>(null)
let useCapture = true
function openCamera() {
  useCapture = true
  fileInput.value?.click()
}
function openAlbum() {
  useCapture = false
  fileInput.value?.click()
}
function onCaptureAttr() {
  return useCapture ? 'environment' : undefined
}

const decoding = ref(false)
const lastResult = ref<string | null>(null)
const lastError = ref<string | null>(null)
const history = ref<string[]>([])

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''  // 允许重复选同一张
  if (!file) return
  lastError.value = null
  lastResult.value = null
  if (!pair.value.trim()) {
    lastError.value = '请先填写电脑端显示的设备码'
    return
  }
  decoding.value = true
  try {
    const bitmap = await createImageBitmap(file)
    const result = await decodeImageBarcode(bitmap)
    bitmap.close()
    if (!result) {
      lastError.value = '未识别到条码，请离近一点、保证条码清晰完整后重试'
      return
    }
    lastResult.value = result.text
    history.value.unshift(result.text)
    await $fetch('/api/scan/push', {
      method: 'POST',
      body: { pair: pair.value.trim(), text: result.text }
    })
  } catch (err: any) {
    lastError.value = err?.statusMessage || err?.data?.statusMessage || err?.message || '处理失败'
  } finally {
    decoding.value = false
  }
}

onBeforeUnmount(stopLive)
</script>

<template>
  <div class="min-h-full bg-surface px-4 py-8 text-ink">
    <div class="mx-auto max-w-md space-y-5">
      <div class="text-center">
        <h1 class="text-xl font-bold">手机扫码</h1>
        <p class="mt-1 text-sm text-ink-tertiary">识别后自动回传电脑</p>
      </div>

      <!-- 设备码 -->
      <div class="rounded-lg bg-surface-raised p-4 ring-1 ring-line">
        <label class="mb-1.5 block text-sm font-medium text-ink-secondary">
          设备码 <span class="text-alert-400">*</span>
        </label>
        <input
          v-model="pair"
          type="text"
          inputmode="numeric"
          maxlength="6"
          placeholder="电脑端 6 位设备码"
          class="w-full rounded-md bg-surface-sunken/40 px-3 py-2.5 text-center font-mono text-2xl tracking-[0.5em] text-data-300 ring-1 ring-line outline-none focus:ring-data-500/50"
        >
        <label class="mt-2 flex items-center gap-2 text-xs text-ink-tertiary">
          <input v-model="rememberPair" type="checkbox" class="accent-data-500">
          记住设备码（固定不变，下次免输）
        </label>
      </div>

      <!-- 实时取景 -->
      <div v-if="liveSupported" class="space-y-2">
        <div v-show="liveOn" class="overflow-hidden rounded-md bg-surface-sunken ring-1 ring-line">
          <video ref="videoRef" class="aspect-video w-full object-cover" muted playsinline />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <button
            v-if="!liveOn"
            class="rounded-lg bg-action py-3.5 text-base font-semibold text-on-action active:bg-action-700 disabled:opacity-50"
            :disabled="liveStarting"
            @click="startLive"
          >
            {{ liveStarting ? '启动中...' : '实时扫码' }}
          </button>
          <button
            v-else
            class="rounded-lg bg-alert-600/80 py-3.5 text-base font-semibold text-on-button active:bg-alert-700"
            @click="stopLive"
          >
            停止实时
          </button>
          <button
            class="rounded-lg bg-surface-muted py-3.5 text-base font-semibold text-ink active:bg-surface-muted disabled:opacity-50"
            :disabled="decoding"
            @click="openCamera"
          >
            {{ decoding ? '识别中...' : '拍一张' }}
          </button>
        </div>
        <p v-if="liveError" class="rounded-md bg-alert-500/10 p-3 text-sm text-alert-300 ring-1 ring-alert-500/30">
          {{ liveError }}
        </p>
      </div>

      <!-- 无实时模式（http 环境）：拍照 + 相册 -->
      <template v-else>
        <div class="rounded-md bg-notice-500/10 p-3 text-xs text-notice-300 ring-1 ring-notice-500/30">
          当前为 http 连接，浏览器不允许实时取景，请使用「拍一张」或相册选图
        </div>
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          :capture="onCaptureAttr()"
          class="hidden"
          @change="onFileChange"
        >
        <div class="grid grid-cols-2 gap-3">
          <button
            class="rounded-lg bg-action py-4 text-base font-semibold text-on-action active:bg-action-700 disabled:opacity-50"
            :disabled="decoding"
            @click="openCamera"
          >
            {{ decoding ? '识别中...' : '拍一张' }}
          </button>
          <button
            class="rounded-lg bg-surface-muted py-4 text-base font-semibold text-ink active:bg-surface-muted disabled:opacity-50"
            :disabled="decoding"
            @click="openAlbum"
          >
            相册选图
          </button>
        </div>
      </template>

      <!-- 拍照模式的隐藏 input（实时模式也要用） -->
      <input
        v-if="liveSupported"
        ref="fileInput"
        type="file"
        accept="image/*"
        :capture="onCaptureAttr()"
        class="hidden"
        @change="onFileChange"
      >

      <!-- 结果 -->
      <div v-if="lastResult" class="rounded-lg bg-gain-500/10 p-4 ring-1 ring-gain-500/30">
        <p class="text-xs text-gain-400">已识别并回传电脑 ✓</p>
        <p class="mt-1 font-mono text-lg break-all text-gain-300">{{ lastResult }}</p>
      </div>
      <div v-if="lastError && !liveError" class="rounded-lg bg-alert-500/10 p-4 text-sm text-alert-300 ring-1 ring-alert-500/30">
        {{ lastError }}
      </div>

      <!-- 历史 -->
      <div v-if="history.length" class="rounded-lg bg-surface-raised p-4 ring-1 ring-line">
        <p class="mb-2 text-xs text-ink-tertiary">本次已发送（{{ history.length }}）</p>
        <p v-for="(h, i) in history" :key="i" class="font-mono text-sm text-ink-secondary">
          {{ h }}
        </p>
      </div>
    </div>
  </div>
</template>
