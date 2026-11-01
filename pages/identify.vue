<script setup lang="ts">
/**
 * 识别 MCU —— 选择通道读取 UID，按 UID 查库：
 *   命中 → 直接跳转对应芯片详情页；未命中 → 提示并带参跳转录入页（UID 预填）。
 * 读取器逻辑与录入页同源（复制适配），只读 identify，不做任何录入动作。
 */
definePageMeta({ title: '识别 MCU' })

interface Chip {
  id: number
  model: string
  uid: string | null
  vendor: string | null
  [key: string]: any
}
interface IdentifyResult {
  matched: boolean
  chip: Chip | null
}

const toast = useToast()

// ---- 读取器选择 ----
const readerKinds = ['STC 系列（8051 / stcgal）', 'WCH CH32V 系列（RISC-V / wlink）', 'WCH CH55x 系列（8051 / USB ISP）', 'AT32 系列（ARM / SWD）', 'STM32 / GD32 系列（ARM / SWD）']
const readerKind = ref(readerKinds[0])
const busy = ref(false)

// ---- 日志框（与录入页同款）----
const logOpen = ref(false)
const logLines = ref<string[]>([])
const logBusy = ref(false)
const logBox = ref<HTMLElement | null>(null)
watch(() => logLines.value.length, async () => {
  await nextTick()
  if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight
})

function openLog(prefix: string) {
  const logId = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  logLines.value = []
  logOpen.value = true
  logBusy.value = true
  const pollLog = () => $fetch<{ lines: string[] }>(`/api/mcu/stc/log`, { query: { logId } })
    .then(lg => { logLines.value = lg.lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '')) })
    .catch(() => {})
  const pollTimer = setInterval(pollLog, 300)
  return { logId, pollLog, pollTimer, stop: async () => {
    logBusy.value = false
    await pollLog()
    clearInterval(pollTimer)
    setTimeout(() => { logOpen.value = false }, 1000)
  } }
}

// ---- 识别结果 ----
const result = ref<{
  kind: string, model: string, vendor: string, uid: string, uid_length: number,
  spec: string, matched: boolean, chip: Chip | null, note: string
} | null>(null)

// ---- STC 串口状态（与录入页同款）----
const stcPorts = ref<{ label: string, device: string }[]>([])
const stcPortsLoading = ref(false)
const stcPortLabel = ref('')
const stcAutoCycle = ref(true)
const stcPortsSig = ref('')
let stcEs: EventSource | null = null

async function refreshStcPorts(silent = false) {
  if (stcPortsLoading.value) return
  if (!silent) stcPortsLoading.value = true
  try {
    const res = await $fetch<{ ports: { device: string, description: string }[] }>('/api/mcu/stc/ports')
    const list = (res.ports || []).map(p => ({
      label: p.description ? `${p.device} — ${p.description}` : p.device,
      device: p.device,
    }))
    const sig = list.map(p => p.label).join('|')
    if (silent && sig === stcPortsSig.value) return
    stcPortsSig.value = sig
    stcPorts.value = list
    if (stcPortLabel.value && !list.some(p => p.label === stcPortLabel.value)) {
      stcPortLabel.value = ''
    }
    if (!stcPortLabel.value) {
      const wch = list.find(p => /wch-link/i.test(p.label))
      if (wch) stcPortLabel.value = wch.label
    }
  } catch {
    if (!silent) toast.add({ title: '枚举串口失败', color: 'error' })
  } finally {
    stcPortsLoading.value = false
  }
}
function startStcWatch() {
  refreshStcPorts()
  if (!stcEs) {
    stcEs = new EventSource('/api/mcu/stc/events')
    stcEs.onmessage = () => refreshStcPorts(true)
  }
}
function stopStcWatch() {
  stcEs?.close()
  stcEs = null
}
onUnmounted(stopStcWatch)
watch(readerKind, (k) => {
  if (k.includes('STC')) startStcWatch()
})
onMounted(() => {
  if (readerKind.value.includes('STC')) startStcWatch()
})
watch(stcPortLabel, (v) => {
  stcAutoCycle.value = /wch-link/i.test(v)
})

// ---- 识别结果处理：UID 查库 → 命中/未命中 ----
async function finishIdentify(kind: string, model: string, vendor: string, uid: string, uidLength: number, spec: string, note = '') {
  let matched = false
  let chip: Chip | null = null
  if (uid) {
    try {
      const idres = await $fetch<IdentifyResult>('/api/identify', {
        method: 'POST',
        body: { jedec_id: '', uid, uid_length: uidLength, chip_type: 'mcu' },
      })
      matched = !!idres.matched
      chip = idres.chip || null
    } catch { /* 查库失败按未命中处理 */ }
  }
  result.value = { kind, model, vendor, uid, uid_length: uidLength, spec, matched, chip, note }
  if (matched && chip) {
    toast.add({ title: `已入库：${chip.model}`, description: '正在打开详情页...', color: 'success' })
    setTimeout(() => navigateTo(`/chips/${chip!.id}`), 800)
  } else if (!uid) {
    toast.add({ title: '已读取（无 UID）', description: note || '该通道不回传 UID，无法按 UID 查库', color: 'warning', timeout: 0 })
  } else {
    toast.add({ title: '未入库', description: `UID ${uid} 不在库存中，可带参跳转录入页建档`, color: 'warning', timeout: 0 })
  }
}

// ---- STC 串口读取（只读，不含擦除；STC15/12/8 的 UID 仅擦除应答携带）----
async function doStcRead() {
  if (busy.value) return
  const port = stcPorts.value.find(p => p.label === stcPortLabel.value)?.device
  if (!port) {
    toast.add({ title: '请先选择串口', description: '选择 STC 芯片所连的 USB-TTL 串口', color: 'warning' })
    return
  }
  const { logId, pollLog, pollTimer, stop } = openLog('stc')
  busy.value = true
  try {
    const res = await $fetch<{
      uid: string, model: string, protocol: string, bsl_version: string, clock_hz: number | null
    }>('/api/mcu/stc/read', { method: 'POST', body: { port, erase: false, autoCycle: stcAutoCycle.value, logId } })
    const hex = (res.uid || '').replace(/\s+/g, '').toUpperCase()
    const spec = `协议 ${res.protocol}｜BSL ${res.bsl_version || '?'}｜时钟 ${res.clock_hz ? `${(res.clock_hz / 1e6).toFixed(3)} MHz` : '未知'}`
    await finishIdentify('STC 串口', res.model || 'STC 芯片', 'STC', hex, Math.max(1, hex.length / 2), spec,
      hex ? '' : 'STC15/12/8 系 BSL 握手不回传 UID（仅擦除应答带）；识别页不做擦除，如需 UID 请到录入页用「空片擦除读取 UID」')
  } catch (e: any) {
    toast.add({
      title: 'STC 读取失败',
      description: `${e?.data?.statusMessage || e?.message || '未知错误'}（确认芯片已断电重新上电、串口未被占用）`,
      color: 'error', timeout: 0,
    })
  } finally {
    busy.value = false
    await pollLog()
    clearInterval(pollTimer)
    await stop()
  }
}

// ---- CH32V 读取 ----
async function doCh32Read() {
  if (busy.value) return
  const { logId, pollLog, pollTimer, stop } = openLog('ch32')
  busy.value = true
  try {
    const res = await $fetch<{
      family: string, model: string, chip_id: string, uid: string,
      uid_length: number, capacity_kb: number | null, protected: boolean | null
    }>('/api/mcu/ch32/read', { method: 'POST', body: { logId } })
    const hex = (res.uid || '').toUpperCase()
    const spec = `家族 ${res.family}｜ChipID 0x${res.chip_id || '?'}｜Flash ${res.capacity_kb != null ? `${res.capacity_kb}KB` : '未知'}`
    if (res.protected) {
      toast.add({
        title: '警告：芯片已开启读保护',
        description: '读保护开启时调试口不可访问 UID，需先在 WCH-LinkUtility 中解除保护',
        color: 'warning', timeout: 0,
      })
    }
    await finishIdentify('CH32V', res.model, 'WCH', hex, res.uid_length, spec)
  } catch (e: any) {
    toast.add({
      title: 'CH32V 读取失败',
      description: `${e?.data?.statusMessage || e?.message || '未知错误'}（确认 SWIO/SCK/GND/3V3 接线、LinkE 为 RV 模式）`,
      color: 'error', timeout: 0,
    })
  } finally {
    busy.value = false
    await pollLog()
    clearInterval(pollTimer)
    await stop()
  }
}

// ---- CH55x 读取 ----
async function doCh55xRead() {
  if (busy.value) return
  const { logId, pollLog, pollTimer, stop } = openLog('ch55x')
  busy.value = true
  try {
    const res = await $fetch<{
      model: string, mcu_type: number, uid: string, uid_length: number, isp_ver: string, port: string
    }>('/api/mcu/ch55/read', { method: 'POST', body: { mode: 'usb', logId } })
    const hex = (res.uid || '').toUpperCase()
    const spec = `BOOT v${res.isp_ver || '?'}`
    await finishIdentify('CH55x', res.model, 'WCH', hex, res.uid_length, spec)
  } catch (e: any) {
    toast.add({
      title: 'CH55x 读取失败',
      description: `${e?.data?.statusMessage || e?.message || '未知错误'}（冷启动：先断电，插 USB 上电即进 BOOT）`,
      color: 'error', timeout: 0,
    })
  } finally {
    busy.value = false
    await pollLog()
    clearInterval(pollTimer)
    await stop()
  }
}

// ---- AT32 读取 ----
async function doAt32Read() {
  if (busy.value) return
  const { logId, pollLog, pollTimer, stop } = openLog('at32')
  busy.value = true
  try {
    const res = await $fetch<{
      model: string, vendor: string | null, uid: string, uid_length: number, id64: string,
      dev_id: string, flash_kb: number | null, package: string | null, matched_table: boolean
    }>('/api/mcu/at32/read', { method: 'POST', body: { logId } })
    const hex = (res.uid || '').toUpperCase()
    const spec = `DEV_ID ${res.dev_id}｜${res.flash_kb ? `${res.flash_kb}KB ${res.package || ''}` : `id64 ${res.id64}`}`
    await finishIdentify('AT32 SWD', res.model, res.vendor || 'Artery', hex, res.uid_length, spec)
  } catch (e: any) {
    toast.add({
      title: 'AT32 读取失败',
      description: `${e?.data?.statusMessage || e?.message || '未知错误'}`,
      color: 'error', timeout: 0,
    })
  } finally {
    busy.value = false
    await pollLog()
    clearInterval(pollTimer)
    await stop()
  }
}

// ---- STM32 / GD32 / PY32 读取 ----
async function doStm32Read() {
  if (busy.value) return
  const { logId, pollLog, pollTimer, stop } = openLog('stm32')
  busy.value = true
  try {
    const res = await $fetch<{
      model: string, vendor: string | null, uid: string, uid_length: number,
      dev_id: string, flash_kb: number | null, matched_table: boolean
    }>('/api/mcu/stm32/read', { method: 'POST', body: { logId } })
    const hex = (res.uid || '').toUpperCase()
    const spec = `DEV_ID ${res.dev_id}｜${res.flash_kb ? `${res.flash_kb}KB` : '容量未知'}`
    await finishIdentify('STM32 SWD', res.model, res.vendor || 'ST', hex, res.uid_length, spec)
  } catch (e: any) {
    toast.add({
      title: 'STM32 读取失败',
      description: `${e?.data?.statusMessage || e?.message || '未知错误'}`,
      color: 'error', timeout: 0,
    })
  } finally {
    busy.value = false
    await pollLog()
    clearInterval(pollTimer)
    await stop()
  }
}

// ---- 去录入（带参预填）----
const newLink = computed(() => {
  if (!result.value) return '/chips/new'
  const q = new URLSearchParams()
  if (result.value.uid) q.set('uid', result.value.uid)
  if (result.value.uid_length) q.set('uid_length', String(result.value.uid_length))
  if (result.value.vendor) q.set('vendor', result.value.vendor)
  if (result.value.model && !result.value.model.startsWith('ARM(') && !result.value.model.startsWith('STM32(')) q.set('model', result.value.model)
  return `/chips/new?${q.toString()}`
})
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-4 p-4">
    <div>
      <h1 class="text-lg font-semibold text-highlighted">识别 MCU</h1>
      <p class="text-sm text-muted">选择通道读取芯片 UID，命中库存直接打开详情页</p>
    </div>

    <!-- 通道与读取 -->
    <div class="rounded-lg border border-primary/20 bg-primary/5 p-3">
      <div class="flex flex-wrap items-center gap-2">
        <USelectMenu v-model="readerKind" :items="readerKinds" size="xs" class="w-64" />
        <template v-if="readerKind.includes('STC')">
          <UInputMenu
            v-model="stcPortLabel"
            :items="stcPorts.map(p => p.label)"
            :loading="stcPortsLoading"
            placeholder="选择 COM 口（可输入过滤）"
            class="w-64"
            size="xs"
          />
          <UButton
            icon="i-lucide-cpu"
            color="primary"
            variant="soft"
            size="xs"
            :loading="busy"
            @click="doStcRead"
          >
            读取
          </UButton>
        </template>
        <UButton
          v-else-if="readerKind.includes('CH32V')"
          icon="i-lucide-cpu"
          color="primary"
          variant="soft"
          size="xs"
          :loading="busy"
          @click="doCh32Read"
        >
          读取
        </UButton>
        <UButton
          v-else-if="readerKind.includes('CH55x')"
          icon="i-lucide-cpu"
          color="primary"
          variant="soft"
          size="xs"
          :loading="busy"
          @click="doCh55xRead"
        >
          读取
        </UButton>
        <UButton
          v-else-if="readerKind.includes('AT32')"
          icon="i-lucide-cpu"
          color="primary"
          variant="soft"
          size="xs"
          :loading="busy"
          @click="doAt32Read"
        >
          读取
        </UButton>
        <UButton
          v-else-if="readerKind.includes('STM32')"
          icon="i-lucide-cpu"
          color="primary"
          variant="soft"
          size="xs"
          :loading="busy"
          @click="doStm32Read"
        >
          读取
        </UButton>
        <span class="flex-1" />
      </div>

      <!-- STC 附加选项与说明 -->
      <div v-if="readerKind.includes('STC')" class="mt-2 space-y-1">
        <UCheckbox
          v-if="/wch-link/i.test(stcPortLabel)"
          v-model="stcAutoCycle"
          label="自动断电重启（WCH-LinkE 软件控 3V3）"
          size="xs"
        />
        <p class="text-xs text-ink-tertiary">
          识别页只做只读读取：STC15/12/8 系 BSL 握手不回传 UID，识别按型号+时钟进行；
          需按 UID 查库请到录入页用「空片擦除读取 UID」。
        </p>
      </div>
      <p v-else-if="readerKind.includes('CH32V')" class="mt-2 text-xs text-ink-tertiary">
        SWIO/SCK/GND/3V3 四线，随时可读。
      </p>
      <p v-else-if="readerKind.includes('CH55x')" class="mt-2 text-xs text-ink-tertiary">
        冷启动进 BOOT：先断电，插 USB 上电即读。
      </p>
      <p v-else-if="readerKind.includes('AT32') || readerKind.includes('STM32')" class="mt-2 text-xs text-ink-tertiary">
        SWD 四线：SWDIO(PA13) / SWCLK(PA14) / GND / 3V3，随时可读、无需断电重启。LinkE 模式自动处理。
      </p>
    </div>

    <!-- 实时日志 -->
    <div v-if="logOpen" class="rounded-lg border border-primary/20 bg-black/30 p-2">
      <div ref="logBox" class="max-h-48 overflow-y-auto font-mono text-xs leading-5 text-primary/80">
        <div v-for="(l, i) in logLines" :key="i">{{ l }}</div>
      </div>
    </div>

    <!-- 识别结果 -->
    <div v-if="result" class="rounded-lg border p-4"
      :class="result.matched ? 'border-green-500/40 bg-green-500/5' : 'border-amber-500/40 bg-amber-500/5'">
      <template v-if="result.matched && result.chip">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-check-circle-2" class="text-xl text-green-500" />
          <span class="text-base font-semibold text-green-500">已入库：{{ result.chip.model }}</span>
        </div>
        <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt class="text-ink-tertiary">品牌</dt><dd>{{ result.chip.vendor || result.vendor }}</dd>
          <dt class="text-ink-tertiary">UID</dt><dd class="font-mono">{{ result.chip.uid }}</dd>
          <dt class="text-ink-tertiary">通道</dt><dd>{{ result.kind }}（{{ result.spec }}）</dd>
        </dl>
        <div class="mt-3 flex gap-2">
          <UButton icon="i-lucide-external-link" color="primary" size="xs" @click="navigateTo(`/chips/${result.chip!.id}`)">
            打开详情页
          </UButton>
        </div>
      </template>
      <template v-else>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-search-x" class="text-xl text-amber-500" />
          <span class="text-base font-semibold text-amber-500">
            {{ result.uid ? '未入库' : '已读取（无 UID）' }}：{{ result.model }}
          </span>
        </div>
        <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt class="text-ink-tertiary">品牌</dt><dd>{{ result.vendor }}</dd>
          <dt v-if="result.uid" class="text-ink-tertiary">UID</dt>
          <dd v-if="result.uid" class="font-mono">{{ result.uid }}</dd>
          <dt class="text-ink-tertiary">通道</dt><dd>{{ result.kind }}（{{ result.spec }}）</dd>
        </dl>
        <p v-if="result.note" class="mt-2 text-xs text-ink-tertiary">{{ result.note }}</p>
        <div class="mt-3 flex gap-2">
          <UButton v-if="result.uid" icon="i-lucide-plus" color="primary" size="xs" :to="newLink">
            去录入（UID 已预填）
          </UButton>
        </div>
      </template>
    </div>
  </div>
</template>
