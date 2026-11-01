<script setup lang="ts">
/**
 * 手机扫码配对弹窗（电脑端）
 * 显示 6 位配对码 + 局域网链接二维码；手机端 /scan 页识别后回传
 * 轮询 /api/scan/pull 取走结果，逐条 emit('scanned')
 */
import qrcode from 'qrcode-generator'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  scanned: [value: string]
}>()

const pairCode = ref('')
const qrSvg = ref('')
const received = ref<string[]>([])
const loading = ref(false)
const errorMsg = ref<string | null>(null)

/** 服务端返回的局域网 IPv4 候选与端口 */
const lanIps = ref<string[]>([])
const lanPort = ref('')
const selectedIp = ref('')

const isLocalhost = computed(() => {
  if (!import.meta.client) return false
  return ['localhost', '127.0.0.1'].includes(window.location.hostname)
})

/** 有局域网 IP 就用局域网地址（协议跟随当前页面，https 下手机才能用实时扫码） */
const scanUrl = computed(() => {
  if (!pairCode.value) return ''
  const base = selectedIp.value
    ? `${window.location.protocol}//${selectedIp.value}${lanPort.value ? ':' + lanPort.value : ''}`
    : window.location.origin
  return `${base}/scan?pair=${pairCode.value}`
})

/** flag 填写的源地址（不含路径），仅客户端且有配对码时求值 */
const scanOrigin = computed(() => {
  if (!pairCode.value) return ''
  return selectedIp.value
    ? `${window.location.protocol}//${selectedIp.value}${lanPort.value ? ':' + lanPort.value : ''}`
    : window.location.origin
})

function renderQr() {
  if (!scanUrl.value) return
  const qr = qrcode(0, 'M')
  qr.addData(scanUrl.value)
  qr.make()
  // 不用 scalable：无 width/height 的 SVG 在 flex 容器里会塌缩成 0 尺寸
  qrSvg.value = qr.createSvgTag({ cellSize: 4, margin: 2 })
}

function cycleIp() {
  const idx = lanIps.value.indexOf(selectedIp.value)
  selectedIp.value = lanIps.value[(idx + 1) % lanIps.value.length]
  renderQr()
}

let pollTimer: ReturnType<typeof setInterval> | null = null

async function createPair() {
  loading.value = true
  errorMsg.value = null
  received.value = []
  try {
    const res = await $fetch<{ code: string; ips: string[]; port: string }>('/api/scan/pair', { method: 'POST' })
    pairCode.value = res.code
    lanIps.value = res.ips || []
    lanPort.value = res.port || ''
    selectedIp.value = lanIps.value[0] || ''
    renderQr()
    startPolling()
  } catch (e: any) {
    errorMsg.value = e?.message || '生成配对码失败'
  } finally {
    loading.value = false
  }
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(async () => {
    try {
      const res = await $fetch<{ texts: string[] }>(`/api/scan/pull`, {
        params: { pair: pairCode.value }
      })
      for (const t of res.texts) {
        received.value.unshift(t)
        emit('scanned', t)
      }
    } catch { /* 网络抖动 → 下个周期重试 */ }
  }, 1200)
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

function close() {
  stopPolling()
  emit('update:open', false)
}

watch(() => props.open, (val) => {
  if (val) createPair()
  else stopPolling()
})

onBeforeUnmount(stopPolling)
</script>

<template>
  <UModal :open="open" title="手机扫码" @update:open="(v: boolean) => { if (!v) close() }">
    <template #body>
      <div class="space-y-4">
        <div v-if="isLocalhost && !lanIps.length" class="rounded-md bg-notice-500/10 p-3 text-xs text-notice-300 ring-1 ring-notice-500/30">
          未检测到局域网网卡 IP，手机无法访问。请确认电脑已连网，然后用
          <code class="font-mono">npx nuxt dev --host</code> 启动。
        </div>

        <div v-if="errorMsg" class="rounded-md bg-alert-500/10 p-3 text-sm text-alert-300 ring-1 ring-alert-500/30">
          {{ errorMsg }}
        </div>

        <template v-else-if="pairCode">
          <div class="flex items-start gap-4">
            <!-- 二维码 -->
            <div class="shrink-0 rounded-md bg-surface-raised p-2" v-html="qrSvg" />
            <!-- 说明 -->
            <div class="min-w-0 flex-1 space-y-2 text-sm text-ink-secondary">
              <p>用手机<b>原生相机</b>扫左侧二维码，直达扫码页</p>
              <p class="text-xs text-ink-tertiary">
                或手机浏览器打开<br>
                <code class="break-all font-mono text-xs text-data-300">{{ scanUrl }}</code>
                <button
                  v-if="lanIps.length > 1"
                  class="ml-1 text-xs text-action underline"
                  @click="cycleIp"
                >
                  换网卡
                </button>
              </p>
              <p class="text-xs text-ink-tertiary">
                固定设备码（永久有效，手机记住一次即可）：<span class="font-mono text-lg tracking-widest text-data-300">{{ pairCode }}</span>
              </p>
              <p class="text-xs text-ink-tertiary">手机首次连接时，Windows 防火墙弹窗请选择「允许」</p>
              <p class="rounded-md bg-action/10 p-2.5 text-xs text-data-300 ring-1 ring-data-500/20">
                想用<b>实时扫码</b>：手机 Chrome 打开 <code class="font-mono">chrome://flags/#unsafely-treat-insecure-origin-as-secure</code>，
                填入 <code class="font-mono">{{ scanOrigin }}</code>，Enabled 后重启浏览器。
                不开启也行，「拍一张」模式不受影响。
              </p>
            </div>
          </div>

          <!-- 收到的条码 -->
          <div v-if="received.length" class="rounded-md bg-gain-500/10 p-3 ring-1 ring-gain-500/30">
            <p class="text-xs text-gain-400">已收到 {{ received.length }} 条，自动填入 ✓</p>
            <p v-for="(t, i) in received.slice(0, 5)" :key="i" class="mt-1 font-mono text-sm text-gain-300">
              {{ t }}
            </p>
          </div>
          <p v-else class="text-xs text-ink-tertiary">
            手机拍完自动回传到这里，识别成功后自动填入条码输入框
          </p>
        </template>

        <p v-else class="text-sm text-ink-tertiary">
          {{ loading ? '正在生成配对码...' : '' }}
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
