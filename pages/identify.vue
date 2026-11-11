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

// ---- 实验性功能开关（🧪 面板在本页底部）----
const { flags: labFlags } = useLab()

// ---- 读取器选择 ----
const baseReaderKinds = ['STC 系列（8051 / stcgal）', 'WCH CH32V 系列（RISC-V / wlink）', 'WCH CH55x 系列（8051 / USB ISP）', 'AT32 系列（ARM / SWD）', 'STM32 系列（ARM / SWD）', 'GD32 系列（ARM / SWD）', 'PY32 系列（ARM / SWD）', 'CW32 系列（ARM / SWD）', 'CS32 系列（ARM / SWD）', 'APM32 系列（ARM / SWD）', 'HC32 系列（ARM / SWD）']
const readerKinds = computed(() =>
  labFlags.value.hk32Read ? [...baseReaderKinds, 'HK32 系列（实验 / SWD）'] : baseReaderKinds)
const readerKind = ref(baseReaderKinds[0])
const busy = ref(false)

// ---- 日志框（与录入页同款）----
const logOpen = ref(false)
const logLines = ref<string[]>([])

// 日志行按级别着色：ERROR 红 / WARN 黄 / INFO 蓝 / 其余默认
function logLineClass(l: string): string {
  if (/^\[(ERR|ERROR)\]/i.test(l) || /^Error\b/.test(l) || /^Traceback/.test(l) || /^错误/.test(l)) return 'text-alert-400'
  if (/^\[WARN(ING)?\]/i.test(l) || /^Warning\b/.test(l) || /^警告/.test(l)) return 'text-amber-500'
  if (/^\[INFO\]/i.test(l)) return 'text-data-300'
  return ''
}
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
const eraseConfirmOpen = ref(false)
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
    toast.add({ title: `已入库：${chip.model}`, description: '点击下方「打开详情页」按钮跳转', color: 'success' })
  } else if (!uid) {
    toast.add({ title: '已读取（无 UID）', description: note || '该通道不回传 UID，无法按 UID 查库', color: 'warning', timeout: 0 })
  } else {
    toast.add({ title: '未入库', description: `UID ${uid} 不在库存中，可带参跳转录入页建档`, color: 'warning', timeout: 0 })
  }
}

// ---- STC 串口读取（读 = 擦除：UID 只在擦除应答里附带，会清空用户程序）----
async function doStcRead() {
  if (busy.value) return
  const port = stcPorts.value.find(p => p.label === stcPortLabel.value)?.device
  if (!port) {
    toast.add({ title: '请先选择串口', description: '选择 STC 芯片所连的 USB-TTL 串口', color: 'warning' })
    return
  }
  eraseConfirmOpen.value = false
  const { logId, pollLog, pollTimer, stop } = openLog('stc-erase')
  busy.value = true
  try {
    const res = await $fetch<{
      uid: string, model: string, protocol: string, bsl_version: string, clock_hz: number | null
    }>('/api/mcu/stc/read', { method: 'POST', body: { port, erase: true, autoCycle: stcAutoCycle.value, logId } })
    const hex = (res.uid || '').replace(/\s+/g, '').toUpperCase()
    const spec = `协议 ${res.protocol}｜BSL ${res.bsl_version || '?'}｜时钟 ${res.clock_hz ? `${(res.clock_hz / 1e6).toFixed(3)} MHz` : '未知'}｜擦除取 UID`
    await finishIdentify('STC 串口', res.model || 'STC 芯片', 'STC', hex, Math.max(1, hex.length / 2), spec, '')
  } catch (e: any) {
    toast.add({
      title: 'STC 擦除读取失败',
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

// ---- GD32 读取（GigaDevice：E23x M23 布局，UID 96bit @0x1FFFF7AC）----
async function doGd32Read() {
  if (busy.value) return
  const { logId, pollLog, pollTimer, stop } = openLog('gd32')
  busy.value = true
  try {
    const res = await $fetch<{
      model: string, vendor: string | null, uid: string, uid_length: number,
      dev_id: string, flash_kb: number | null, matched_table: boolean
    }>('/api/mcu/gd32/read', { method: 'POST', body: { logId } })
    const hex = (res.uid || '').toUpperCase()
    const spec = `DEV_ID ${res.dev_id}｜${res.flash_kb ? `${res.flash_kb}KB` : '容量未知'}`
    await finishIdentify('GD32 SWD', res.model, res.vendor || 'GigaDevice', hex, res.uid_length, spec)
  } catch (e: any) {
    toast.add({
      title: 'GD32 读取失败',
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

// ---- CW32 读取（WHXY 武汉芯源：数字签名区 ASCII 型号自报家门，UID 80bit @0x001007B0）----
async function doCw32Read() {
  if (busy.value) return
  const { logId, pollLog, pollTimer, stop } = openLog('cw32')
  busy.value = true
  try {
    const res = await $fetch<{
      model: string, family: string, vendor: string | null, uid: string, uid_length: number,
      cpuid: string, pin_count: number | null, sram_kb: number | null,
      flash_kb: number | null, matched_table: boolean
    }>('/api/mcu/cw32/read', { method: 'POST', body: { logId } })
    const hex = (res.uid || '').toUpperCase()
    const spec = `CPUID ${res.cpuid}｜${res.flash_kb ? `${res.flash_kb}KB Flash` : '容量未知'}`
    await finishIdentify('CW32 SWD', res.model, res.vendor || 'WHXY', hex, res.uid_length, spec)
  } catch (e: any) {
    toast.add({
      title: 'CW32 读取失败',
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

// ---- CS32 读取（Chipsea 芯海：DBG_ID DEV_ID=0x444 与 STM32F0 同款，UID 96bit @0x1FFFF7AC，F0 同款签名区布局）----
async function doCs32Read() {
  if (busy.value) return
  const { logId, pollLog, pollTimer, stop } = openLog('cs32')
  busy.value = true
  try {
    const res = await $fetch<{
      model: string, vendor: string | null, uid: string, uid_length: number,
      dev_id: string, flash_kb: number | null, matched_table: boolean
    }>('/api/mcu/cs32/read', { method: 'POST', body: { logId } })
    const hex = (res.uid || '').toUpperCase()
    const spec = `DEV_ID ${res.dev_id}｜${res.flash_kb ? `${res.flash_kb}KB` : '容量未知'}`
    await finishIdentify('CS32 SWD', res.model, res.vendor || 'Chipsea', hex, res.uid_length, spec)
  } catch (e: any) {
    toast.add({
      title: 'CS32 读取失败',
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

// ---- APM32 读取（Geehy 极海：官方无 DEV_ID 实锤，电子签名区直读，UID 96bit @0x000203E4）----
async function doApm32Read() {
  if (busy.value) return
  const { logId, pollLog, pollTimer, stop } = openLog('apm32')
  busy.value = true
  try {
    const res = await $fetch<{
      model: string, vendor: string | null, uid: string, uid_length: number,
      cpuid: string, dev_id: string, flash_kb: number | null
    }>('/api/mcu/apm32/read', { method: 'POST', body: { logId } })
    const hex = (res.uid || '').toUpperCase()
    const spec = `CPUID ${res.cpuid}${res.dev_id ? `｜DEV_ID ${res.dev_id}` : ''}｜${res.flash_kb ? `${res.flash_kb}KB` : '容量未知'}`
    await finishIdentify('APM32 SWD', res.model, res.vendor || 'Geehy', hex, res.uid_length, spec)
  } catch (e: any) {
    toast.add({
      title: 'APM32 读取失败',
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

// ---- HC32 读取（XHSC 小华：官方无 DEV_ID 实锤，UID 10B @0x0010 0E74，VCAP 必须接 4.7uF）----
async function doHc32Read() {
  if (busy.value) return
  const { logId, pollLog, pollTimer, stop } = openLog('hc32')
  busy.value = true
  try {
    const res = await $fetch<{
      model: string, vendor: string | null, uid: string, uid_length: number,
      cpuid: string, dev_id: string, uid_window: string, flash_kb: number | null
    }>('/api/mcu/hc32/read', { method: 'POST', body: { logId } })
    const hex = (res.uid || '').toUpperCase()
    const spec = `CPUID ${res.cpuid}${res.dev_id ? `｜DEV_ID ${res.dev_id}` : ''}`
    await finishIdentify('HC32 SWD', res.model, res.vendor || 'XHSC', hex, res.uid_length, spec)
  } catch (e: any) {
    toast.add({
      title: 'HC32 读取失败',
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

// ---- HK32 读取（🧪 实验：航顺 HK32F030M，UID 64bit @0x1FFFF818，当年"漂移"= VCAP 悬空）----
async function doHk32Read() {
  if (busy.value) return
  const { logId, pollLog, pollTimer, stop } = openLog('hk32')
  busy.value = true
  try {
    const res = await $fetch<{
      model: string, vendor: string | null, uid: string, uid_length: number,
      dev_id: string, rev_id: string, flash_kb: number | null
    }>('/api/mcu/hk32/read', { method: 'POST', body: { logId } })
    const hex = (res.uid || '').toUpperCase()
    const spec = `DEV_ID ${res.dev_id || '缺席（M 系=0）'}｜REV_ID ${res.rev_id}｜${res.flash_kb ? `${res.flash_kb}KB（系列固定）` : ''}`
    await finishIdentify('HK32 SWD', res.model, res.vendor || 'Hangshun', hex, res.uid_length, spec)
  } catch (e: any) {
    toast.add({
      title: 'HK32 读取失败',
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

// ---- PY32 读取（Puya 特殊布局：UID 16B @0x1FFF0E00，DEV_ID 缺席靠 0x78 特征码）----
async function doPy32Read() {
  if (busy.value) return
  const { logId, pollLog, pollTimer, stop } = openLog('py32')
  busy.value = true
  try {
    const res = await $fetch<{
      model: string, vendor: string | null, uid: string, uid_length: number,
      dev_id: string, flash_kb: number | null, matched_table: boolean
    }>('/api/mcu/stm32/read', { method: 'POST', body: { logId } })
    const hex = (res.uid || '').toUpperCase()
    const spec = 'UID 16B（0x78 特征码' + (res.uid[24] === '7' && res.uid[25] === '8' ? '命中' : '未命中') + '）'
    await finishIdentify('PY32 SWD', res.model, res.vendor || 'Puya', hex, res.uid_length, spec)
  } catch (e: any) {
    toast.add({
      title: 'PY32 读取失败',
      description: (e?.data?.statusMessage || e?.message || '未知错误'),
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
  if (result.value.model && !result.value.model.startsWith('ARM(') && !result.value.model.startsWith('STM32(') && !result.value.model.startsWith('GD32(') && !result.value.model.startsWith('CS32(')) q.set('model', result.value.model)
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
            icon="i-lucide-flame"
            color="error"
            variant="soft"
            size="xs"
            :disabled="busy"
            @click="eraseConfirmOpen = true"
          >
            擦除并读取UID
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
        <UButton
          v-else-if="readerKind.includes('GD32')"
          icon="i-lucide-cpu"
          color="primary"
          variant="soft"
          size="xs"
          :loading="busy"
          @click="doGd32Read"
        >
          读取
        </UButton>
        <UButton
          v-else-if="readerKind.includes('PY32')"
          icon="i-lucide-cpu"
          color="primary"
          variant="soft"
          size="xs"
          :loading="busy"
          @click="doPy32Read"
        >
          读取
        </UButton>
        <UButton
          v-else-if="readerKind.includes('CW32')"
          icon="i-lucide-cpu"
          color="primary"
          variant="soft"
          size="xs"
          :loading="busy"
          @click="doCw32Read"
        >
          读取
        </UButton>
        <UButton
          v-else-if="readerKind.includes('CS32')"
          icon="i-lucide-cpu"
          color="primary"
          variant="soft"
          size="xs"
          :loading="busy"
          @click="doCs32Read"
        >
          读取
        </UButton>
        <UButton
          v-else-if="readerKind.includes('APM32')"
          icon="i-lucide-cpu"
          color="primary"
          variant="soft"
          size="xs"
          :loading="busy"
          @click="doApm32Read"
        >
          读取
        </UButton>
        <UButton
          v-else-if="readerKind.includes('HC32')"
          icon="i-lucide-cpu"
          color="primary"
          variant="soft"
          size="xs"
          :loading="busy"
          @click="doHc32Read"
        >
          读取
        </UButton>
        <UButton
          v-else-if="readerKind.includes('HK32')"
          icon="i-lucide-flask-conical"
          color="special"
          variant="soft"
          size="xs"
          :loading="busy"
          @click="doHk32Read"
        >
          读取（实验）
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
          UID 只在擦除应答里附带（STC15/12/8 系 BSL 握手不带），所以「擦除并读取UID」是唯一取 UID 的路径——会清空用户程序且不可恢复，仅适用空片/可弃片。
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
      <p v-else-if="readerKind.includes('GD32')" class="mt-2 text-xs text-ink-tertiary">
        独立 GD32 通道（Cortex-M23 E23x）：UID 96bit @<b>0x1FFFF7AC</b>，与 STM32F1 的 0x1FFFF7E8 不同，
        故单独拆分避免 DEV_ID 0x410 误读。F1 兼容的 GD32F103 仍走 STM32 通道。
      </p>
      <p v-else-if="readerKind.includes('PY32')" class="mt-2 text-xs text-ink-tertiary">
        Puya PY32 独立通道：SWD 四线同上，但 UID 为 <b>16 字节 @0x1FFF0E00</b>（Lot ASCII + Wafer + 坐标 +
        偏移 12 固定码 0x78），且 DBG_IDCODE 不含 DEV_ID——识别靠 0x78 特征码，与 STM32 家族表机制完全不同。
      </p>
      <p v-else-if="readerKind.includes('CW32')" class="mt-2 text-xs text-ink-tertiary">
        武汉芯源 CW32 独立通道：无 DEV_ID 寄存器，识别靠数字签名区（UM Rev1.1 §24）——
        型号以 <b>ASCII @0x0010 07E0</b> 自报家门，UID 为 <b>80bit（10 字节）@0x0010 07B0</b>，
        顺带读出 Flash/SRAM 容量与引脚数。SWD 四线同上，随时可读；深度休眠下 DAP 停摆需先唤醒（§23.8）。
      </p>
      <p v-else-if="readerKind.includes('CS32')" class="mt-2 text-xs text-ink-tertiary">
        芯海 CS32 独立通道：电子签名区布局与 STM32F0 全同款——DBG_ID 的 DEV_ID 实测也是
        <b>0x444</b>（CS32F035F6P7 真机 DBG_ID=0x10006444；UM 复位值 0x1000644X 末位为通配）。
        UID 96bit @<b>0x1FFFF7AC</b>、Flash 容量 @0x1FFFF7CC（UM REV1.1 §25 实锤）。
        SWD 四线同上，随时可读。
      </p>
      <p v-else-if="readerKind.includes('APM32')" class="mt-2 text-xs text-ink-tertiary">
        极海 APM32 独立通道：官方文档无 DEV_ID 实锤，识别直接读电子签名区（系统存储区
        0x0002 0000-03FF）——UID 96bit @<b>0x0002 03E4</b>、Flash 容量 @0x0002 03E0
        （UM V1.7 §20 + OpenOCD patch + 同型号实测三源印证）。SWD 四线同上，随时可读。
      </p>
      <p v-else-if="readerKind.includes('HC32')" class="mt-2 text-xs text-ink-tertiary">
        小华 HC32 独立通道：官方无 DEV_ID 实锤，识别直接读电子签名区——
        UID <b>10 字节 @0x0010 0E74-0E7F</b>（DS Rev2.72 实锤，另 dump 16B 窗口核对老版口径）。
        <b>VCAP（pin8）= LDO 内核供电输出，官方要求接 4.7uF 电容到 GND</b>——悬空会导致读数
        "位拉 1"污染（档案 #59 旧 UID 中间含 FFFF 即此因）。SWD 四线同上，随时可读。
      </p>
      <p v-else-if="readerKind.includes('HK32')" class="mt-2 text-xs text-ink-tertiary">
        🧪 航顺 HK32F030M（实验通道）：M 系信息块布局与 STM32F0 完全不同——
        UID 为 <b>64bit（8 字节）@0x1FFFF818</b>（DS Rev1.3 图 3-2，别按 F0 习惯读 0x1FFFF7AC），
        16KB Flash 为全系列固定规格；M 系裸 die 的 DBG_IDCODE 实测全 0（DEV_ID 缺席，非故障）。
        内置双读校验；<b>VCAP 务必接 4.7uF</b>——当年 UID"漂移"就是它悬空造成的假象。
      </p>
    </div>

    <!-- 实时日志 -->
    <div v-if="logOpen" class="rounded-lg border border-primary/20 bg-black/30 p-2">
      <div class="mb-1 flex items-center justify-between">
        <span class="text-xs text-ink-tertiary">读取日志{{ logBusy ? '（进行中…）' : '（已完成，可手动关闭）' }}</span>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          :disabled="logBusy"
          aria-label="关闭日志"
          @click="logOpen = false"
        />
      </div>
      <div ref="logBox" class="max-h-48 overflow-y-auto font-mono text-xs leading-5 text-primary/80">
        <div v-for="(l, i) in logLines" :key="i" :class="logLineClass(l)">{{ l }}</div>
      </div>
    </div>

    <!-- 擦除并读取 UID 确认框（警戒框即弹窗本体，不再框内框） -->
    <HazardConfirmModal
      v-model:open="eraseConfirmOpen"
      title="擦除并读取 UID"
      code="STC / CHIP ERASE"
    >
      <div class="space-y-2 text-sm">
        <p>将向芯片发送擦除命令，从擦除应答取回 7 字节 UID（STC15/12/8 系列 BSL 只在擦除应答里附带 UID）。</p>
        <ul class="list-disc space-y-1 pl-5 text-xs text-ink-secondary">
          <li>片内<b class="text-alert-400">用户程序会被全部擦除，不可恢复</b>——仅适用于未烧程序的空片</li>
          <li>UID 区（程序区最后 7 字节）受硬件保护，擦不掉，擦除后 UID 依然有效</li>
          <li>读取后芯片停在 BSL，需重新上电才能运行程序</li>
        </ul>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="eraseConfirmOpen = false">
            取消
          </UButton>
          <UButton
            icon="i-lucide-flame"
            color="error"
            :loading="busy"
            @click="doStcRead()"
          >
            确认擦除并读取
          </UButton>
        </div>
      </template>
    </HazardConfirmModal>

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

    <LabFeaturesPanel />
  </div>
</template>
