<script setup lang="ts">
const route = useRoute()
import type { Chip, ProbeResult } from '~~/shared/types'

interface IdentifyResult {
  matched: boolean
  match_by: 'uid' | 'jedec_id' | null
  reason?: string
  chip?: Chip
  candidates?: { id: number; model: string; jedec_id: string; uid: string; uid_length: number; capacity: string; created_at: string; chip_type?: string }[]
}

definePageMeta({
  title: '录入芯片'
})

const mode = ref<'auto' | 'manual'>('auto')
const chipType = ref<'flash' | 'mcu' | 'other'>('flash')

// ---- 自动录入 (Probe) ----
const probing = ref(false)
const probeResult = ref<ProbeResult | null>(null)
const probeError = ref<string | null>(null)
const identifyResult = ref<IdentifyResult | null>(null)
let userDismissedIdentify = false

// 从 sessionStorage 恢复识别结果
onMounted(() => {
  // 「识别MCU」页未命中带参跳转：UID/型号/厂商 预填
  try {
    const q = route.query
    if (q.uid) {
      const hex = String(q.uid).replace(/\s+/g, '').toUpperCase()
      form.uid = hex.replace(/(..)/g, '$1 ').trim()
      form.uid_length = Number(q.uid_length) || Math.max(1, hex.length / 2)
      toast.add({ title: '已带入识别结果', description: `UID ${hex} 未入库，补全信息后保存`, color: 'info' })
    }
    if (q.model) form.model = String(q.model)
    if (q.vendor) form.vendor = String(q.vendor)
  } catch { /* 预填失败不阻断 */ }

  try {
    const saved = sessionStorage.getItem('new-identify-result')
    if (saved) {
      identifyResult.value = JSON.parse(saved)
    }
    const savedProbe = sessionStorage.getItem('new-probe-result')
    if (savedProbe) {
      probeResult.value = JSON.parse(savedProbe)
    }
  } catch {
    // ignore
  }
})

// 持久化识别结果和探测结果（仅在非用户关闭时更新）
watch(identifyResult, (val) => {
  if (userDismissedIdentify) {
    try { sessionStorage.removeItem('new-identify-result') } catch { /* ignore */ }
    userDismissedIdentify = false
    return
  }
  try {
    if (val) {
      sessionStorage.setItem('new-identify-result', JSON.stringify(val))
    }
  } catch { /* ignore */ }
})

watch(probeResult, (val) => {
  try {
    if (val) {
      sessionStorage.setItem('new-probe-result', JSON.stringify(val))
    }
  } catch { /* ignore */ }
})

async function probe() {
  probing.value = true
  probeError.value = null
  probeResult.value = null
  identifyResult.value = null
  try {
    const result = await $fetch<ProbeResult>('/api/probe', { method: 'POST' })
    probeResult.value = result
    if (result.error) {
      probeError.value = result.error
      return
    }

    // 根据 JEDEC ID 判断芯片类型
    const jedecId = (result.jedec_id || '').trim()
    chipType.value = jedecId ? 'flash' : 'mcu'

    const identify = await $fetch<IdentifyResult>('/api/identify', {
      method: 'POST',
      body: {
        jedec_id: result.jedec_id,
        uid: result.uid,
        uid_length: result.uid_length,
        chip_type: chipType.value
      }
    })
    identifyResult.value = identify

    if (identify.matched && identify.chip) {
      return
    }

    form.model = result.model || identify.candidates?.[0]?.model || ''
    form.chip_type = chipType.value
    form.jedec_id = result.jedec_id
    form.uid = result.uid
    form.uid_length = result.uid_length
    form.capacity = jedecIdToCapacity(result.jedec_id) || ''
    form.vendor = jedecIdToVendor(result.jedec_id, form.model) || ''
    mode.value = 'manual'
  } catch (e: any) {
    probeError.value = e.data?.message || e.message || '读取芯片失败'
  } finally {
    probing.value = false
  }
}

function chipTypeLabel(type?: string | null) {
  return type === 'mcu' ? 'MCU' : type === 'other' ? '其他' : 'Flash'
}

function goToMatchedChip() {
  if (identifyResult.value?.chip) {
    navigateTo(`/chips/${identifyResult.value.chip.id}`)
  }
}

function startNewArchive() {
  if (probeResult.value) {
    form.model = identifyResult.value?.candidates?.[0]?.model || ''
    form.chip_type = chipType.value
    form.jedec_id = probeResult.value.jedec_id
    form.uid = probeResult.value.uid
    form.uid_length = probeResult.value.uid_length
    form.capacity = jedecIdToCapacity(probeResult.value.jedec_id) || ''
  }
  userDismissedIdentify = true
  identifyResult.value = null
  mode.value = 'manual'
}

// ---- 手动录入表单 ----
// 品牌选项：内置 + 手动添加的品牌，录入只能从已录品牌中选择
const { data: brandList } = await useFetch<{ name: string }[]>('/api/brands')
const brandOptions = computed(() => (brandList.value ?? []).map(b => b.name))

// 封装选项：内置 + 手动添加的封装，录入只能从已录封装中选择
const { data: packageList } = await useFetch<{ name: string }[]>('/api/packages')
const packageOptions = computed(() => (packageList.value ?? []).map(p => p.name))

// 芯片类型（两级）：仅「其他」类型使用，来自立创式分类列表
interface CategoryItem { id: number, name: string, parent_id: number | null }
const { data: categoryList } = await useFetch<CategoryItem[]>('/api/chip-categories')
const categoryRoots = computed(() =>
  (categoryList.value ?? [])
    .filter(c => c.parent_id === null)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
)
const rootOptions = computed(() => categoryRoots.value.map(c => c.name))

// 一级分类的选择值（只用于筛二级，不入库）
const categoryRoot = ref('')
const childOptions = computed(() => {
  const root = categoryRoots.value.find(c => c.name === categoryRoot.value)
  if (!root) return []
  return (categoryList.value ?? [])
    .filter(c => c.parent_id === root.id)
    .map(c => c.name)
    .sort((a, b) => a.localeCompare(b, 'zh'))
})

const form = reactive({
  vendor: '',
  model: '',
  chip_type: 'flash' as 'flash' | 'mcu' | 'other',
  jedec_id: '',
  uid: '',
  uid_length: 8,
  capacity: '',
  package: '',
  chip_category: '',
  qty_per_bag: 1,
  location_a: '',
  location_b: '',
  location_c: '',
  note: ''
})

// 单包颗数：只有「其他」类型 + 未填 UID（含填 "/" 占位）才能改，其余情况恒为 1
const qtyEnabled = computed(() =>
  form.chip_type === 'other' && (!String(form.uid ?? '').trim() || isNoUid(form.uid))
)
watch(qtyEnabled, (on) => {
  if (!on) form.qty_per_bag = 1
})

// ---- STC UID 自动读取（仅 MCU 类型，独立 USB-TTL 串口，与扫描仪同款 spawn 模式）----
const toast = useToast()
const stcPorts = ref<{ label: string, device: string }[]>([])
const stcPortLabel = ref('')
const stcPortsLoading = ref(false)
const stcReading = ref(false)
const eraseConfirmOpen = ref(false)
const stcAutoCycle = ref(true)
// UID 自动读取面板：折叠 + 读取器系列菜单（以后加 ARM 等系列就往数组里添项）
const stcPanelOpen = ref(false)
// 读取器系列菜单：以后加新系列就往数组里添项
// STC USB ISP 已下线（用户拍板）：UID 字节数未定案 + 每次读取需 P3.2 短接进 BOOT，操作繁琐。
// 完整实现保留（stc_usb_read.py / usb_read.post.ts，实测可读 UID），恢复 = 加回下面注释项。
// 'STC USB（AI8H/STC32G / USB ISP）',
const readerKinds = ['STC 系列（8051 / stcgal）', 'WCH CH32V 系列（RISC-V / wlink）', 'WCH CH55x 系列（8051 / USB ISP）', 'AT32 系列（ARM / SWD）', 'STM32 / GD32 系列（ARM / SWD）']
const readerKind = ref(readerKinds[0])
const stcLogOpen = ref(false)
const stcLogLines = ref<string[]>([])
const stcLogBusy = ref(false)
const stcLogBox = ref<HTMLElement | null>(null)
// CH32V 读取后按 UID 查库的命中结果（「可能是入过库的」：读出来直接提示已入库）
const ch32Matched = ref<Chip | null>(null)
// CH55x 读取后按 UID 查库的命中结果（同 ch32Matched）
const ch55xMatched = ref<Chip | null>(null)
// STC USB 读取后按 UID 查库的命中结果
const stcUsbMatched = ref<Chip | null>(null)
// AT32 SWD 读取后按 UID 查库的命中结果
const at32Matched = ref<Chip | null>(null)
// STM32 SWD 读取后按 UID 查库的命中结果
const stm32Matched = ref<Chip | null>(null)

watch(() => stcLogLines.value.length, async () => {
  await nextTick()
  if (stcLogBox.value) stcLogBox.value.scrollTop = stcLogBox.value.scrollHeight
})

// 仅 WCH-Link 有电源输出可控（wlink set-power）：选了普通 USB-TTL 强制关闭自动断电
watch(stcPortLabel, (v) => {
  stcAutoCycle.value = /wch-link/i.test(v)
})

watch(() => form.chip_type, (t) => {
  if (t === 'mcu') startStcWatch()
  else stopStcWatch()
})

async function refreshStcPorts(silent = false) {
  if (stcPortsLoading.value) return
  if (!silent) stcPortsLoading.value = true
  try {
    const res = await $fetch<{ ports: { device: string, description: string }[] }>('/api/mcu/stc/ports')
    const list = (res.ports || []).map(p => ({
      label: p.description ? `${p.device} — ${p.description}` : p.device,
      device: p.device,
    }))
    // 静默轮询时结果没变就不动 UI（避免下拉抖动）
    const sig = list.map(p => p.label).join('|')
    if (silent && sig === stcPortsSig.value) return
    stcPortsSig.value = sig
    stcPorts.value = list
    // 当前选中口已拔出 → 清空；未选中 → 默认选 WCH-Link（用户主力）
    if (stcPortLabel.value && !list.some(p => p.label === stcPortLabel.value)) {
      stcPortLabel.value = ''
    }
    if (!stcPortLabel.value) {
      const wch = list.find(p => /wch-link/i.test(p.label))
      if (wch) stcPortLabel.value = wch.label
    }
  } catch (e: any) {
    if (!silent) {
      toast.add({
        title: '枚举串口失败',
        description: e?.data?.statusMessage || e?.message || '未知错误',
        color: 'error',
      })
    }
  } finally {
    stcPortsLoading.value = false
  }
}

// MCU 面板打开期间监听串口插拔：SSE 收 Windows 设备事件后重新枚举（零轮询热刷新）
const stcPortsSig = ref('')
let stcEs: EventSource | null = null

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

/**
 * 从 STC 芯片读取：stcgal 库方式只握手+初始化，程序原样保留。
 * 读前必须断电→重新上电：STC 仅在上电瞬间检测下载口令进入 BSL。
 *
 * UID 说明（datasheet 1.13 节 + stcgal 源码）：STC15/12/8 系列 BSL 只在
 * 擦除应答里附带 UID，握手包没有 → 只读模式 uid 为空属正常，
 * 空片请用「空片擦除读取 UID」（erase=true，会毁片内程序）。
 */
async function doStcRead(erase: boolean) {
  if (stcReading.value) return
  const port = stcPorts.value.find(p => p.label === stcPortLabel.value)?.device
  if (!port) {
    toast.add({ title: '请先选择串口', description: '选择 STC 芯片所连的 USB-TTL 串口', color: 'warning' })
    return
  }
  eraseConfirmOpen.value = false

  // 实时日志框：wlink / stcgal 原文按行滚动展示，跑完自动关
  const logId = `stc-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  stcLogLines.value = []
  stcLogOpen.value = true
  stcLogBusy.value = true
  const pollLog = () => $fetch<{ lines: string[] }>(`/api/mcu/stc/log`, { query: { logId } })
    .then(lg => {
      // wlink 输出带 ANSI 颜色码，先清掉再展示
      stcLogLines.value = lg.lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, ''))
    })
    .catch(() => {}) // 404/日志未建时静默
  const pollTimer = setInterval(pollLog, 300)

  stcReading.value = true
  try {
    const res = await $fetch<{
      uid: string, model: string, protocol: string, bsl_version: string,
      clock_hz: number | null, trim_data: string
    }>('/api/mcu/stc/read', { method: 'POST', body: { port, erase, autoCycle: stcAutoCycle.value, logId } })
    const hex = (res.uid || '').replace(/\s+/g, '').toUpperCase()
    const spec = `协议 ${res.protocol}｜BSL ${res.bsl_version || '?'}｜时钟 ${res.clock_hz ? `${(res.clock_hz / 1e6).toFixed(3)} MHz` : '未知'}`
    // BSL 握手成功即确认 STC 品牌；型号来自 Magic 查表，一并填进表单
    if (res.model) form.model = res.model
    form.vendor = 'STC'
    if (hex) {
      form.uid = hex.replace(/(..)/g, '$1 ').trim()
      form.uid_length = Math.max(1, hex.length / 2)
      toast.add({
        title: `读取成功：${res.model || 'STC 芯片'}${erase ? '（已执行擦除）' : ''}`,
        description: `UID ${hex}｜${spec}`,
        color: 'success',
        timeout: 0,
      })
    } else {
      toast.add({
        title: `已读取：${res.model || 'STC 芯片'}（无 UID）`,
        description: `${spec}。BSL 握手不回传 UID（仅擦除应答带）；空片可用「空片擦除读取 UID」`,
        color: 'warning',
        timeout: 0,
      })
    }
  } catch (e: any) {
    toast.add({
      title: 'STC 读取失败',
      description: `${e?.data?.statusMessage || e?.message || '未知错误'}（确认芯片已断电重新上电、串口未被占用）`,
      color: 'error',
      timeout: 0,
    })
  } finally {
    stcReading.value = false
    stcLogBusy.value = false
    await pollLog() // 最后拉一次全量日志（含 done 标记与结尾行）
    clearInterval(pollTimer)
    setTimeout(() => { stcLogOpen.value = false }, 1000)
  }
}

/**
 * 从 CH32V（RISC-V）读取：wlink.exe status 走 WCH-LinkE 调试口（SWIO/SCK），
 * 随时可连、无需断电重启；UID 在硬件电子签名区，只读不擦不写，无危险操作。
 * 读完自动填 品牌/型号/UID/容量，并按 UID 查库提示是否已入库。
 */
async function doCh32Read() {
  if (stcReading.value) return

  // 实时日志框：与 STC 共用组件与轮询端点（__stcLogs 缓冲）
  const logId = `ch32-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  stcLogLines.value = []
  stcLogOpen.value = true
  stcLogBusy.value = true
  const pollLog = () => $fetch<{ lines: string[] }>(`/api/mcu/stc/log`, { query: { logId } })
    .then(lg => {
      stcLogLines.value = lg.lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, ''))
    })
    .catch(() => {}) // 404/日志未建时静默
  const pollTimer = setInterval(pollLog, 300)

  stcReading.value = true
  ch32Matched.value = null
  try {
    const res = await $fetch<{
      family: string, model: string, chip_id: string, uid: string,
      uid_length: number, capacity_kb: number | null, protected: boolean | null
    }>('/api/mcu/ch32/read', { method: 'POST', body: { logId } })
    const hex = (res.uid || '').toUpperCase()
    const spec = `家族 ${res.family}｜ChipID 0x${res.chip_id || '?'}｜Flash ${res.capacity_kb != null ? `${res.capacity_kb}KB` : '未知'}`
    // attach 命中即确认 WCH 品牌；精确型号来自 wlink 内置 chip_id 映射
    if (res.model) form.model = res.model
    form.vendor = 'WCH'
    if (hex) {
      form.uid = hex.replace(/(..)/g, '$1 ').trim()
      form.uid_length = Math.max(1, hex.length / 2)
    }
    if (res.capacity_kb) form.capacity = `${res.capacity_kb * 8}Kbit / ${res.capacity_kb}KB`
    if (res.protected) {
      toast.add({
        title: '警告：芯片已开启读保护',
        description: '读保护开启时调试口不可访问 UID，需先在 WCH-LinkUtility 中解除保护',
        color: 'warning',
        timeout: 0,
      })
    }
    // 按 UID 查库：可能入过库，命中直接提示
    if (hex) {
      try {
        const idres = await $fetch<IdentifyResult>('/api/identify', {
          method: 'POST',
          body: { jedec_id: '', uid: hex, uid_length: res.uid_length, chip_type: 'mcu' },
        })
        if (idres.matched && idres.chip) {
          ch32Matched.value = idres.chip
          toast.add({
            title: `该芯片已入库：${idres.chip.model}`,
            description: `UID ${hex} 命中已有档案，可在下方查看或直接打开`,
            color: 'info',
            timeout: 0,
          })
        }
      } catch { /* 查库失败不影响填写 */ }
    }
    toast.add({
      title: `读取成功：${res.model}`,
      description: `UID ${hex || '无'}｜${spec}`,
      color: 'success',
      timeout: 0,
    })
  } catch (e: any) {
    toast.add({
      title: 'CH32V 读取失败',
      description: `${e?.data?.statusMessage || e?.message || '未知错误'}（确认 SWIO/SCK/GND/3V3 接线、LinkE 为 RV 模式）`,
      color: 'error',
      timeout: 0,
    })
  } finally {
    stcReading.value = false
    stcLogBusy.value = false
    await pollLog() // 最后拉一次全量日志（含 done 标记与结尾行）
    clearInterval(pollTimer)
    setTimeout(() => { stcLogOpen.value = false }, 1000)
  }
}

/**
 * 从 CH55x（8051）读取：USB ISP。CH55x 无 SWD/JTAG（官方手册实锤），出厂 2KB BOOT
 * 用户程序删不掉；冷启动 + D+（USB）高电平进 BOOT（BOOT 模式 USB PID=0x55E0），
 * 后端 spawn ch55x_identify.exe（官方 WCH55xISPDLL.dll，USB 模式）identify 取 UID，
 * 只读不擦不写。读完自动填 品牌/型号/UID，并按 UID 查库提示是否已入库。
 */
async function doCh55xRead() {
  if (stcReading.value) return

  // 实时日志框：与 STC/CH32V 共用组件与轮询端点（__stcLogs 缓冲）
  const logId = `ch55x-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  stcLogLines.value = []
  stcLogOpen.value = true
  stcLogBusy.value = true
  const pollLog = () => $fetch<{ lines: string[] }>(`/api/mcu/stc/log`, { query: { logId } })
    .then(lg => {
      stcLogLines.value = lg.lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, ''))
    })
    .catch(() => {}) // 404/日志未建时静默
  const pollTimer = setInterval(pollLog, 300)

  stcReading.value = true
  ch55xMatched.value = null
  try {
    const res = await $fetch<{
      model: string, mcu_type: number, uid: string, uid_length: number,
      isp_ver: string, port: string
    }>('/api/mcu/ch55/read', {
      method: 'POST',
      body: { mode: 'usb', logId },
    })
    const hex = (res.uid || '').toUpperCase()
    // identify 命中即确认 WCH 品牌；型号来自 ISP McuType 映射（CH552/CH554...）
    if (res.model) form.model = res.model
    form.vendor = 'WCH'
    if (hex) {
      form.uid = hex.replace(/(..)/g, '$1 ').trim()
      form.uid_length = Math.max(1, hex.length / 2)
    }
    // 按 UID 查库：可能入过库，命中直接提示
    if (hex) {
      try {
        const idres = await $fetch<IdentifyResult>('/api/identify', {
          method: 'POST',
          body: { jedec_id: '', uid: hex, uid_length: res.uid_length, chip_type: 'mcu' },
        })
        if (idres.matched && idres.chip) {
          ch55xMatched.value = idres.chip
          toast.add({
            title: `该芯片已入库：${idres.chip.model}`,
            description: `UID ${hex} 命中已有档案，可在下方查看或直接打开`,
            color: 'info',
            timeout: 0,
          })
        }
      } catch { /* 查库失败不影响填写 */ }
    }
    toast.add({
      title: `读取成功：${res.model}`,
      description: `UID ${hex || '无'}｜BOOT v${res.isp_ver || '?'}`,
      color: 'success',
      timeout: 0,
    })
  } catch (e: any) {
    toast.add({
      title: 'CH55x 读取失败',
      description: `${e?.data?.statusMessage || e?.message || '未知错误'}（确认冷启动时已插 USB：先断电，插上 USB 线再上电即冷启动进 BOOT）`,
      color: 'error',
      timeout: 0,
    })
  } finally {
    stcReading.value = false
    stcLogBusy.value = false
    await pollLog() // 最后拉一次全量日志（含 done 标记与结尾行）
    clearInterval(pollTimer)
    setTimeout(() => { stcLogOpen.value = false }, 1000)
  }
}

/**
 * 从 STC USB 芯片（AI8H2K12U/STC32G12K128 等带硬件 USB 的 STC）读取：USB HID 免驱。
 * 进 BOOT = P3.2 短接 GND + 重新上电（用户手动，脚本内轮询等待 20s）。
 * 协议为抓包逆向的 USB BSL（帧 46B9+6a/68+len+cs+16），只读 identify。
 */
async function doStcUsbRead() {
  if (stcReading.value) return

  const logId = `stcusb-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  stcLogLines.value = []
  stcLogOpen.value = true
  stcLogBusy.value = true
  const pollLog = () => $fetch<{ lines: string[] }>(`/api/mcu/stc/log`, { query: { logId } })
    .then(lg => { stcLogLines.value = lg.lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '')) })
    .catch(() => {})
  const pollTimer = setInterval(pollLog, 300)

  stcReading.value = true
  stcUsbMatched.value = null
  try {
    const res = await $fetch<{
      model: string, uid: string, uid_length: number, status_hex: string
    }>('/api/mcu/stc/usb_read', { method: 'POST', body: { logId } })

    const hex = (res.uid || '').toUpperCase()
    if (res.model) form.model = res.model
    form.vendor = 'STC'
    if (hex) {
      form.uid = hex.replace(/(..)/g, '$1 ').trim()
      form.uid_length = res.uid_length || hex.length / 2
    }
    // 按 UID 查库：可能入过库，命中直接提示
    if (hex) {
      try {
        const idres = await $fetch<IdentifyResult>('/api/identify', {
          method: 'POST',
          body: { jedec_id: '', uid: hex, uid_length: res.uid_length, chip_type: 'mcu' },
        })
        if (idres.matched && idres.chip) {
          stcUsbMatched.value = idres.chip
          toast.add({
            title: `该芯片已入库：${idres.chip.model}`,
            description: `UID ${hex} 命中已有档案，可在下方查看或直接打开`,
            color: 'info',
            timeout: 0,
          })
        }
      } catch { /* 查库失败不影响填写 */ }
    }
    toast.add({
      title: `读取成功：${res.model || 'STC 芯片'}`,
      description: hex ? `UID ${hex}` : '未取得 UID',
      color: 'success',
      timeout: 0,
    })
  } catch (e: any) {
    toast.add({
      title: 'STC USB 读取失败',
      description: `${e?.data?.statusMessage || e?.message || '未知错误'}`,
      color: 'error',
      timeout: 0,
    })
  } finally {
    stcReading.value = false
    stcLogBusy.value = false
    await pollLog()
    clearInterval(pollTimer)
    setTimeout(() => { stcLogOpen.value = false }, 1000)
  }
}

/**
 * 从 AT32/GD32 等 ARM Cortex-M 芯片读取：pyOCD + LinkE DAP 模式（CMSIS-DAP 免驱）。
 * SWD 四线随时可读、无需断电重启、无需 halt（attach 模式不打扰运行中的芯片）。
 * 识别 = Artery 官方 AN0016 算法（PID+系列字节→64 位 ID 查表）+ UID 96bit。
 * 模式保险：API 层自动把 LinkE 切到 DAP（RV 模式下 CH32V 流程会坏）。
 */
async function doAt32Read() {
  if (stcReading.value) return

  const logId = `at32-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  stcLogLines.value = []
  stcLogOpen.value = true
  stcLogBusy.value = true
  const pollLog = () => $fetch<{ lines: string[] }>(`/api/mcu/stc/log`, { query: { logId } })
    .then(lg => { stcLogLines.value = lg.lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '')) })
    .catch(() => {})
  const pollTimer = setInterval(pollLog, 300)

  stcReading.value = true
  at32Matched.value = null
  try {
    const res = await $fetch<{
      model: string, vendor: string | null, uid: string, uid_length: number, id64: string,
      dev_id: string, flash_kb: number | null, package: string | null, matched_table: boolean
    }>('/api/mcu/at32/read', { method: 'POST', body: { logId } })

    const hex = (res.uid || '').toUpperCase()
    if (res.model && !res.model.startsWith('ARM(')) form.model = res.model
    if (res.vendor) form.vendor = res.vendor
    if (hex) {
      form.uid = hex.replace(/(..)/g, '$1 ').trim()
      form.uid_length = res.uid_length || hex.length / 2
    }
    if (hex) {
      try {
        const idres = await $fetch<IdentifyResult>('/api/identify', {
          method: 'POST',
          body: { jedec_id: '', uid: hex, uid_length: res.uid_length, chip_type: 'mcu' },
        })
        if (idres.matched && idres.chip) {
          at32Matched.value = idres.chip
          toast.add({
            title: `该芯片已入库：${idres.chip.model}`,
            description: `UID ${hex} 命中已有档案`,
            color: 'info',
            timeout: 0,
          })
        }
      } catch { /* 查库失败不影响填写 */ }
    }
    toast.add({
      title: `读取成功：${res.model}`,
      description: `UID ${hex || '未取得'}｜${res.flash_kb ? `${res.flash_kb}KB ${res.package || ''}` : '未入型号表（id64 已输出）'}`,
      color: 'success',
      timeout: 0,
    })
  } catch (e: any) {
    toast.add({
      title: 'AT32 读取失败',
      description: `${e?.data?.statusMessage || e?.message || '未知错误'}`,
      color: 'error',
      timeout: 0,
    })
  } finally {
    stcReading.value = false
    stcLogBusy.value = false
    await pollLog()
    clearInterval(pollTimer)
    setTimeout(() => { stcLogOpen.value = false }, 1000)
  }
}

async function doStm32Read() {
  if (stcReading.value) return

  const logId = `stm32-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  stcLogLines.value = []
  stcLogOpen.value = true
  stcLogBusy.value = true
  const pollLog = () => $fetch<{ lines: string[] }>(`/api/mcu/stc/log`, { query: { logId } })
    .then(lg => { stcLogLines.value = lg.lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '')) })
    .catch(() => {})
  const pollTimer = setInterval(pollLog, 300)

  stcReading.value = true
  stm32Matched.value = null
  try {
    const res = await $fetch<{
      model: string, vendor: string | null, uid: string, uid_length: number, id64: string,
      dev_id: string, flash_kb: number | null, package: string | null, matched_table: boolean
    }>('/api/mcu/stm32/read', { method: 'POST', body: { logId } })

    const hex = (res.uid || '').toUpperCase()
    // 家族名仅供参考（DEV_ID 只到家族级），不自动覆盖手填的精确型号
    // if (res.model) form.model = res.model
    if (res.vendor) form.vendor = res.vendor
    if (hex) {
      form.uid = hex.replace(/(..)/g, '$1 ').trim()
      form.uid_length = res.uid_length || hex.length / 2
    }
    if (hex) {
      try {
        const idres = await $fetch<IdentifyResult>('/api/identify', {
          method: 'POST',
          body: { jedec_id: '', uid: hex, uid_length: res.uid_length, chip_type: 'mcu' },
        })
        if (idres.matched && idres.chip) {
          stm32Matched.value = idres.chip
          toast.add({
            title: `该芯片已入库：${idres.chip.model}`,
            description: `UID ${hex} 命中已有档案`,
            color: 'info',
            timeout: 0,
          })
        }
      } catch { /* 查库失败不影响填写 */ }
    }
    toast.add({
      title: `读取成功：${res.model}`,
      description: `UID ${hex || '未取得'}｜${res.flash_kb ? `${res.flash_kb}KB ${res.package || ''}` : '未入型号表（id64 已输出）'}`,
      color: 'success',
      timeout: 0,
    })
  } catch (e: any) {
    toast.add({
      title: 'STM32 读取失败',
      description: `${e?.data?.statusMessage || e?.message || '未知错误'}`,
      color: 'error',
      timeout: 0,
    })
  } finally {
    stcReading.value = false
    stcLogBusy.value = false
    await pollLog()
    clearInterval(pollTimer)
    setTimeout(() => { stcLogOpen.value = false }, 1000)
  }
}

// 切换一级分类时，已选二级不在新范围则清空
watch(categoryRoot, () => {
  if (form.chip_category && !childOptions.value.includes(form.chip_category)) {
    form.chip_category = ''
  }
})

// JEDEC ID 变化时自动识别容量和厂商（仅在字段为空时自动填写，不覆盖用户手动填的值）
watch(() => form.jedec_id, (val) => {
  if (val && form.chip_type === 'flash' && !form.capacity) {
    const cap = jedecIdToCapacity(val)
    if (cap) form.capacity = cap
  }
  if (val && !form.vendor) {
    const v = jedecIdToVendor(val, form.model)
    if (v) form.vendor = v
  }
})

// 封装记忆：库里存在同型号 → 自动选同款封装并提示（封装为空时才填，不覆盖手选）。
// 自动读取（STC/CH32V）填入型号时同样生效——同型号封装应统一
watch(() => form.model, async (val) => {
  const m = val?.trim()
  if (!m || form.package) return
  try {
    const rows: any[] = await $fetch('/api/chips', { params: { model: m } })
    // 竞态防护：请求返回时型号已改，丢弃本次结果
    if (form.model.trim() !== m) return
    const pkg = rows.find(r => r.package)?.package
    if (pkg && packageOptions.value.includes(pkg)) {
      form.package = pkg
      toast.add({
        title: `已按库内同型号自动选择封装：${pkg}`,
        description: `「${m}」库内已有 ${rows.length} 条档案，封装沿用该型号统一值`,
        color: 'info',
      })
    }
  } catch { /* 查库失败静默，手动选 */ }
})

// 库位：大箱 + 小箱填齐后，序号自动取同组最大 + 1
let fetchSeqPromise: Promise<void> | null = null
async function tryAutoSeq() {
  if (!form.location_a?.trim() || !form.location_b?.trim() || form.location_c?.trim()) return
  if (fetchSeqPromise) return  // 去重
  fetchSeqPromise = (async () => {
    try {
      const rows: any[] = await $fetch('/api/chips', {
        params: { location_a: form.location_a.trim(), location_b: form.location_b.trim() }
      })
      let maxN = 0
      for (const r of rows) {
        const n = parseInt(r.location_c, 10)
        if (!isNaN(n) && n > maxN) maxN = n
      }
      if (!form.location_c?.trim()) form.location_c = String(maxN + 1)
    } catch { /* 网络失败就让用户手动填 */ }
    fetchSeqPromise = null
  })()
}
watch(() => [form.location_a, form.location_b] as const, () => tryAutoSeq())

const submitting = ref(false)
const submitError = ref<string | null>(null)

const errors = computed(() => {
  const e: Record<string, string> = {}
  if (!form.model.trim()) e.model = '型号为必填项'

  if (form.chip_type === 'flash') {
    // Flash: JEDEC ID 必填 + 合法性校验
    const jedecCheck = isValidJedecId(form.jedec_id)
    if (!jedecCheck.valid && jedecCheck.error) e.jedec_id = jedecCheck.error
  } else if (form.chip_type === 'mcu' && form.jedec_id.trim()) {
    // MCU: 填了就校验合法性，没填跳过
    if (!isValidHex(form.jedec_id)) e.jedec_id = '只能包含十六进制字符 (0-9, A-F)'
  }

  if (form.chip_type === 'other') {
    // 其他类型: 必须选择一级 + 二级分类；UID 可选，填了才校验十六进制
    if (!categoryRoot.value) {
      e.category_root = '请选择一级分类'
    } else if (!form.chip_category.trim()) {
      e.chip_category = childOptions.value.length
        ? '请选择二级分类'
        : '该一级分类下暂无二级分类，请先去芯片类型列表添加'
    }
    if (form.uid.trim() && !isValidHex(form.uid)) {
      e.uid = '只能包含十六进制字符 (0-9, A-F)'
    }
    // 单包颗数：填了才校验（服务端也会兜底）
    if (qtyEnabled.value) {
      const q = Number(form.qty_per_bag)
      if (!Number.isInteger(q) || q < 1) e.qty_per_bag = '单包颗数必须是 ≥ 1 的整数'
    }
  } else {
    const uidCheck = isValidUid(form.uid, Number(form.uid_length))
    if (!uidCheck.valid && uidCheck.error) e.uid = uidCheck.error
  }

  return e
})

const isValid = computed(() => Object.keys(errors.value).length === 0)

async function submit() {
  if (!isValid.value) return
  submitting.value = true
  submitError.value = null
  try {
    const result = await $fetch<Chip>('/api/chips', {
      method: 'POST',
      body: {
        vendor: form.vendor.trim() || null,
        model: form.model.trim(),
        chip_type: form.chip_type,
        jedec_id: form.chip_type === 'other' ? '' : form.jedec_id.trim(),
        uid: form.uid.trim() || null,
        uid_length: Number(form.uid_length),
        capacity: form.chip_type === 'other' ? null : (form.capacity.trim() || null),
        package: form.package.trim() || null,
        chip_category: form.chip_type === 'other' ? form.chip_category.trim() : null,
        qty_per_bag: qtyEnabled.value ? (Number(form.qty_per_bag) || 1) : 1,
        location_a: form.location_a.trim() || null,
        location_b: form.location_b.trim() || null,
        location_c: form.location_c.trim() || null,
        note: form.note.trim() || null
      }
    })
    navigateTo(`/chips/${result.id}`)
  } catch (e: any) {
    submitError.value = e.data?.message || e.message || '提交失败'
  } finally {
    submitting.value = false
  }
}

function resetForm() {
  form.vendor = ''
  form.model = ''
  form.chip_type = 'flash'
  form.jedec_id = ''
  form.uid = ''
  form.uid_length = 8
  form.capacity = ''
  form.package = ''
  form.chip_category = ''
  categoryRoot.value = ''
  form.qty_per_bag = 1
  form.location_a = ''
  form.location_b = ''
  form.location_c = ''
  form.note = ''
  submitError.value = null
  userDismissedIdentify = true
  probeResult.value = null
  probeError.value = null
  identifyResult.value = null
  try { sessionStorage.removeItem('new-probe-result') } catch { /* ignore */ }
}
</script>

<template>
  <div class="min-h-full p-6">
    <!-- 页头 -->
    <div class="mb-6 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <UButton
          to="/chips"
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          size="sm"
        />
        <div>
          <h2 class="text-xl font-bold text-ink">录入芯片</h2>
          <p class="mt-1 text-sm text-ink-tertiary">通过 CH341 读取或手动录入新芯片</p>
        </div>
      </div>
    </div>

    <!-- 模式切换 -->
    <div class="mb-6 inline-flex rounded-lg bg-surface-raised p-1 ring-1 ring-line">
      <button
        class="rounded-md px-4 py-2 text-sm font-medium transition-colors"
        :class="mode === 'auto' ? 'bg-data-500/15 text-action' : 'text-ink-secondary hover:text-ink'"
        @click="mode = 'auto'"
      >
        <UIcon name="i-lucide-radio" class="mr-2 inline h-4 w-4" />
        自动录入
      </button>
      <button
        class="rounded-md px-4 py-2 text-sm font-medium transition-colors"
        :class="mode === 'manual' ? 'bg-data-500/15 text-action' : 'text-ink-secondary hover:text-ink'"
        @click="mode = 'manual'"
      >
        <UIcon name="i-lucide-pencil" class="mr-2 inline h-4 w-4" />
        手动录入
      </button>
    </div>

    <!-- 自动录入模式 -->
    <div v-if="mode === 'auto'" class="max-w-2xl">
      <div class="rounded-lg bg-surface-raised p-8 ring-1 ring-line">
        <div class="text-center">
          <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-action/10 ring-1 ring-data-500/20">
            <UIcon name="i-lucide-radio" class="h-8 w-8 text-action" :class="{ 'animate-pulse': probing }" />
          </div>
          <h3 class="text-lg font-semibold text-ink">读取芯片</h3>
          <p class="mt-1 text-sm text-ink-tertiary">
            将芯片连接到 CH341 编程器，然后点击下方按钮读取芯片信息
          </p>
        </div>

        <div class="mt-6 flex justify-center">
          <UButton
            size="lg"
            color="primary"
            variant="solid"
            icon="i-lucide-zap"
            :loading="probing"
            :disabled="probing"
            @click="probe"
          >
            {{ probing ? '正在读取...' : '读取芯片' }}
          </UButton>
        </div>

        <!-- 读取结果 -->
        <div v-if="probeResult && !probeError" class="mt-6 space-y-3">
          <div class="rounded-md bg-surface-muted p-4 ring-1 ring-line">
            <div class="mb-3 flex items-center gap-2">
              <UIcon name="i-lucide-check-circle" class="h-5 w-5 text-gain-400" />
              <span class="text-sm font-medium text-gain-300">读取成功</span>
            </div>
            <dl class="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt class="text-xs text-ink-tertiary">类型</dt>
                <dd class="font-mono" :class="chipType === 'mcu' ? 'text-region' : 'text-action'">
                  {{ chipType === 'mcu' ? 'MCU 单片机' : 'Flash 存储' }}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-ink-tertiary">JEDEC ID</dt>
                <dd class="font-mono text-action">{{ formatJedecId(probeResult.jedec_id) }}</dd>
              </div>
              <div>
                <dt class="text-xs text-ink-tertiary">UID</dt>
                <dd class="font-mono text-action">{{ formatUid(probeResult.uid) }}</dd>
              </div>
              <div>
                <dt class="text-xs text-ink-tertiary">UID 长度</dt>
                <dd class="font-mono text-ink-secondary">{{ probeResult.uid_length }}</dd>
              </div>
            </dl>
          </div>

          <!-- 档案命中 -->
          <div
            v-if="identifyResult?.matched && identifyResult.chip"
            class="rounded-md bg-data-500/5 p-4 ring-1 ring-action/30"
          >
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-fingerprint" class="h-5 w-5 text-action" />
              <span class="text-sm font-semibold text-data-300">已识别档案</span>
              <UBadge color="info" variant="subtle" size="xs" class="font-mono">
                by {{ identifyResult.match_by }}
              </UBadge>
            </div>
            <div class="mt-3 space-y-1 rounded-md bg-surface-muted p-3 font-mono text-xs text-ink-secondary">
              <div>型号：<span class="text-action">{{ identifyResult.chip.model }}</span></div>
              <div>类型：<span class="text-action">{{ chipTypeLabel(identifyResult.chip.chip_type) }}</span></div>
              <div>JEDEC ID：<span class="text-action">{{ formatJedecId(identifyResult.chip.jedec_id) }}</span></div>
              <div>容量：<span class="text-action">{{ identifyResult.chip.capacity || '-' }}</span></div>
              <div>创建于：<span class="text-ink-tertiary">{{ formatDate(identifyResult.chip.created_at) }}</span></div>
            </div>
            <div class="mt-3 flex justify-end gap-2">
              <UButton
                color="primary"
                variant="solid"
                size="sm"
                icon="i-lucide-external-link"
                @click="goToMatchedChip"
              >
                查看档案详情
              </UButton>
            </div>
          </div>

          <!-- 档案未命中 -->
          <div
            v-else-if="identifyResult && !identifyResult.matched"
            class="rounded-md bg-notice-500/5 p-4 ring-1 ring-notice-500/30"
          >
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-package-plus" class="h-5 w-5 text-notice-400" />
              <span class="text-sm font-semibold text-notice-300">未识别到档案</span>
            </div>
            <p class="mt-2 text-sm text-ink-secondary">{{ identifyResult.reason }}</p>

            <!-- 同型号候选 -->
            <div v-if="identifyResult.candidates?.length" class="mt-3 space-y-2">
              <p class="text-xs text-ink-tertiary">同 JEDEC ID 的已存在芯片：</p>
              <div
                v-for="c in identifyResult.candidates"
                :key="c.id"
                class="flex items-center justify-between rounded-md bg-surface-muted p-2 text-xs"
              >
                <div class="font-mono text-ink-secondary">
                  <span class="text-ink-tertiary">#{{ c.id }}</span>
                  <span class="ml-2 text-action">{{ c.model }}</span>
                  <span v-if="c.chip_type" class="ml-1" :class="c.chip_type === 'mcu' ? 'text-region' : 'text-action'">[{{ chipTypeLabel(c.chip_type) }}]</span>
                  <span class="ml-2 text-ink-tertiary">UID: {{ truncateUid(c.uid, 12) }}</span>
                </div>
                <UButton
                  :to="`/chips/${c.id}`"
                  variant="ghost"
                  size="xs"
                  color="neutral"
                >
                  查看
                </UButton>
              </div>
            </div>

            <div class="mt-3 flex justify-end">
              <UButton
                color="primary"
                variant="solid"
                size="sm"
                icon="i-lucide-plus"
                @click="startNewArchive"
              >
                创建新档案
              </UButton>
            </div>
          </div>
        </div>

        <!-- 读取错误 -->
        <div v-if="probeError" class="mt-6 rounded-md bg-alert-500/5 p-4 ring-1 ring-alert-500/20">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-alert-triangle" class="h-5 w-5 text-alert-400" />
            <span class="text-sm font-medium text-alert-300">读取失败</span>
          </div>
          <p class="mt-2 text-sm text-alert-300">{{ probeError }}</p>
          <UButton
            size="sm"
            variant="link"
            color="neutral"
            class="mt-2"
            @click="mode = 'manual'"
          >
            改为手动录入 →
          </UButton>
        </div>
      </div>
    </div>

    <!-- 手动录入表单 -->
    <div v-else class="max-w-2xl">
      <div class="rounded-lg bg-surface-raised p-6 ring-1 ring-line">
        <div class="space-y-5">
          <!-- 芯片类型 -->
          <div>
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">
              芯片类型 <span class="text-alert-400">*</span>
            </label>
            <div class="flex gap-3">
              <button
                type="button"
                class="flex-1 rounded-md border px-4 py-3 text-sm font-medium transition-colors"
                :class="form.chip_type === 'flash'
                  ? 'border-data-500 bg-action/10 text-action'
                  : 'border-line bg-surface-muted text-ink-secondary hover:text-ink'"
                @click="form.chip_type = 'flash'"
              >
                <UIcon name="i-lucide-memory-stick" class="mr-2 inline h-4 w-4" />
                Flash 存储
              </button>
              <button
                type="button"
                class="flex-1 rounded-md border px-4 py-3 text-sm font-medium transition-colors"
                :class="form.chip_type === 'mcu'
                  ? 'border-special-500 bg-special-500/10 text-region'
                  : 'border-line bg-surface-muted text-ink-secondary hover:text-ink'"
                @click="form.chip_type = 'mcu'"
              >
                <UIcon name="i-lucide-cpu" class="mr-2 inline h-4 w-4" />
                MCU 单片机
              </button>
              <button
                type="button"
                class="flex-1 rounded-md border px-4 py-3 text-sm font-medium transition-colors"
                :class="form.chip_type === 'other'
                  ? 'border-ink-tertiary bg-surface-muted/10 text-ink'
                  : 'border-line bg-surface-muted text-ink-secondary hover:text-ink'"
                @click="form.chip_type = 'other'"
              >
                <UIcon name="i-lucide-box" class="mr-2 inline h-4 w-4" />
                其他
              </button>
            </div>
          </div>

          <!-- 芯片类型（仅「其他」需要，两级均必填） -->
          <div v-if="form.chip_type === 'other'" class="space-y-1.5">
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label class="mb-1.5 block text-sm font-medium text-ink-secondary">
                  一级分类 <span class="text-alert-400">*</span>
                </label>
                <UInputMenu
                  v-model="categoryRoot"
                  :items="rootOptions"
                  placeholder="选择一级分类（可输入过滤）"
                  class="w-full"
                />
                <p v-if="errors.category_root" class="mt-1 text-xs text-alert-400">{{ errors.category_root }}</p>
              </div>
              <div>
                <label class="mb-1.5 block text-sm font-medium text-ink-secondary">
                  二级分类 <span class="text-alert-400">*</span>
                </label>
                <UInputMenu
                  v-model="form.chip_category"
                  :items="childOptions"
                  :disabled="!categoryRoot"
                  placeholder="选择二级分类（可输入过滤）"
                  class="w-full"
                />
                <p v-if="errors.chip_category" class="mt-1 text-xs text-alert-400">{{ errors.chip_category }}</p>
              </div>
            </div>
            <p class="text-xs text-ink-tertiary">
              分类体系参照立创商城。没有想要的分类？先去
              <NuxtLink to="/chip-types" class="text-action hover:underline">芯片类型列表</NuxtLink> 新增或导入
            </p>

            <!-- 单包颗数：一袋几颗，默认 1；填了 UID 则锁定为 1 -->
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label class="mb-1.5 block text-sm font-medium text-ink-secondary">
                  单包颗数
                  <span v-if="!qtyEnabled" class="text-xs font-normal text-ink-tertiary">
                    （已填 UID，固定为 1）
                  </span>
                </label>
                <UInput
                  v-model.number="form.qty_per_bag"
                  type="number"
                  min="1"
                  step="1"
                  :disabled="!qtyEnabled"
                  placeholder="1"
                  class="w-full"
                  :class="{ 'ring-1 ring-alert-500/50': errors.qty_per_bag }"
                />
                <p v-if="errors.qty_per_bag" class="mt-1 text-xs text-alert-400">{{ errors.qty_per_bag }}</p>
                <p v-else-if="qtyEnabled" class="mt-1 text-xs text-ink-tertiary">
                  一袋装几颗，默认 1；一袋装 2 颗就填 2
                </p>
              </div>
            </div>
          </div>

          <!-- 厂商：只能从已录品牌中选择（内置+手动添加），缺失品牌先到「品牌列表」新增 -->
          <div>
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">厂商</label>
            <UInputMenu
              v-model="form.vendor"
              :items="brandOptions"
              placeholder="选择品牌（可输入过滤）"
              class="w-full"
            />
            <p class="mt-1 text-xs text-ink-tertiary">
              没有想要的品牌？先去 <NuxtLink to="/brands" class="text-action hover:underline">品牌列表</NuxtLink> 新增
            </p>
          </div>

          <!-- 型号 -->
          <div>
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">
              型号 <span class="text-alert-400">*</span>
            </label>
            <UInput
              v-model="form.model"
              :placeholder="form.chip_type === 'mcu' ? '如: STM32F103C8T6' : form.chip_type === 'other' ? '如: 传感器 / 模块型号' : '如: W25Q128'"
              class="w-full"
              :class="{ 'ring-1 ring-alert-500/50': errors.model }"
            />
            <p v-if="errors.model" class="mt-1 text-xs text-alert-400">{{ errors.model }}</p>
          </div>

          <!-- JEDEC ID / 芯片 ID（其他类型不需要） -->
          <div v-if="form.chip_type !== 'other'">
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">
              {{ form.chip_type === 'mcu' ? '芯片 ID' : 'JEDEC ID' }}
              <span v-if="form.chip_type === 'flash'" class="text-alert-400">*</span>
            </label>
            <UInput
              v-model="form.jedec_id"
              :placeholder="form.chip_type === 'mcu' ? '如: STM32F103 或 留空' : '如: EF 40 18'"
              class="w-full font-mono"
              :class="{ 'ring-1 ring-alert-500/50': errors.jedec_id }"
            />
            <p v-if="errors.jedec_id" class="mt-1 text-xs text-alert-400">{{ errors.jedec_id }}</p>
            <p v-else-if="form.chip_type === 'mcu'" class="mt-1 text-xs text-ink-tertiary">MCU 无 JEDEC ID，可填芯片系列标识或留空</p>
          </div>

          <!-- UID -->
          <div>
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">
              UID
              <span v-if="form.chip_type !== 'other'" class="text-alert-400">*</span>
              <span v-else class="text-xs font-normal text-ink-tertiary">（可选）</span>
            </label>
            <UInput
              v-model="form.uid"
              placeholder="如: DE AD BE EF 12 34 56 78"
              class="w-full font-mono"
              :class="{ 'ring-1 ring-alert-500/50': errors.uid }"
            />
            <p v-if="errors.uid" class="mt-1 text-xs text-alert-400">{{ errors.uid }}</p>
            <p class="mt-1 text-xs text-ink-tertiary">格式: 十六进制，空格分隔；出厂无 UID（如旺宏 MX25）填 /</p>

            <!-- UID 自动读取（仅 MCU）：折叠面板 + 读取器系列菜单 -->
            <div v-if="form.chip_type === 'mcu'" class="mt-3 rounded-md border border-special-500/20 bg-special-500/5">
              <div class="flex items-center gap-1.5 p-2.5">
                <UButton
                  :icon="stcPanelOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                  color="special"
                  variant="ghost"
                  size="xs"
                  :padded="false"
                  @click="stcPanelOpen = !stcPanelOpen"
                />
                <button
                  class="text-sm font-medium text-special-300"
                  @click="stcPanelOpen = !stcPanelOpen"
                >
                  UID 自动读取
                </button>
                <USelectMenu v-model="readerKind" :items="readerKinds" size="xs" class="w-52" />
                <span class="flex-1" />
                <template v-if="readerKind.includes('stcgal')">
                  <UButton
                    icon="i-lucide-cpu"
                    color="special"
                    variant="soft"
                    size="xs"
                    :loading="stcReading"
                    @click="doStcRead(false)"
                  >
                    从STC读取
                  </UButton>
                  <UButton
                    icon="i-lucide-flame"
                    color="error"
                    variant="soft"
                    size="xs"
                    :disabled="stcReading"
                    @click="eraseConfirmOpen = true"
                  >
                    空片擦除读UID
                  </UButton>
                </template>
                <UButton
                  v-else-if="readerKind.includes('USB ISP')"
                  icon="i-lucide-cpu"
                  color="special"
                  variant="soft"
                  size="xs"
                  :loading="stcReading"
                  @click="doStcUsbRead()"
                >
                  读取STC信息
                </UButton>
                <UButton
                  v-else-if="readerKind.includes('CH32V')"
                  icon="i-lucide-cpu"
                  color="special"
                  variant="soft"
                  size="xs"
                  :loading="stcReading"
                  @click="doCh32Read()"
                >
                  读取CH32V信息
                </UButton>
                <UButton
                  v-else-if="readerKind.includes('CH55x')"
                  icon="i-lucide-cpu"
                  color="special"
                  variant="soft"
                  size="xs"
                  :loading="stcReading"
                  @click="doCh55xRead()"
                >
                  读取CH55x信息
                </UButton>
                <UButton
                  v-else-if="readerKind.includes('AT32')"
                  icon="i-lucide-cpu"
                  color="special"
                  variant="soft"
                  size="xs"
                  :loading="stcReading"
                  @click="doAt32Read()"
                >
                  读取AT32信息
                </UButton>
              </div>
              <div v-if="stcPanelOpen" class="space-y-3 border-t border-special-500/10 p-3">
                <template v-if="readerKind.includes('stcgal')">
                  <div class="flex items-end gap-2">
                    <div class="min-w-0 flex-1">
                      <label class="mb-1 block text-xs font-medium text-ink-secondary">STC 串口（独立 USB-TTL，CH341A 正被 SPI 占用）</label>
                      <UInputMenu
                        v-model="stcPortLabel"
                        :items="stcPorts.map(p => p.label)"
                        :loading="stcPortsLoading"
                        placeholder="选择 COM 口（可输入过滤）"
                        class="w-full"
                      />
                    </div>
                  </div>
                  <div class="space-y-1.5">
                    <UCheckbox
                      v-if="/wch-link/i.test(stcPortLabel)"
                      v-model="stcAutoCycle"
                      label="自动断电重启（WCH-LinkE 软件控 3V3，免手动掉电）"
                    />
                    <p class="text-xs text-ink-tertiary">
                      读取前给芯片断电→重新上电（STC 只在上电瞬间检测下载口令）；只读不擦不写，程序原样保留。
                      <span class="text-alert-400/80">空片擦除读UID 会毁掉片内程序，仅用于未烧程序的空片</span>
                    </p>
                  </div>
                </template>
                <template v-else-if="readerKind.includes('USB ISP')">
                  <p class="text-xs text-ink-tertiary">
                    USB ISP：芯片 D-/P3.0、D+/P3.1 直连 USB 口，HID 免驱。
                    进 BOOT：<b class="text-ink-secondary">P3.2 短接 GND 的状态下重新上电</b>（识别出来后 P3.2 可松开）。
                    只读 identify，不擦不写，程序原样保留；读取后芯片留在 BOOT 可连续读取，重新上电即回用户程序。
                    适用 AI8H2K12U / STC32G12K128 等带硬件 USB 的 STC。
                  </p>
                  <div
                    v-if="stcUsbMatched"
                    class="flex items-center gap-2 rounded border border-data-500/30 bg-data-500/10 px-2.5 py-1.5 text-xs text-data-300"
                  >
                    <span>该 UID 已入库：<b>{{ stcUsbMatched.model }}</b></span>
                    <UButton
                      icon="i-lucide-external-link"
                      color="data"
                      variant="ghost"
                      size="xs"
                      @click="navigateTo(`/chips/${stcUsbMatched.id}`)"
                    >
                      打开档案
                    </UButton>
                  </div>
                </template>
                <template v-else-if="readerKind.includes('CH32V')">
                  <p class="text-xs text-ink-tertiary">
                    WCH-LinkE 调试口直连（SWIO/SCK/GND/3V3 四线），随时可读、无需断电重启；
                    UID 在硬件电子签名区，只读不擦不写，程序原样保留。
                  </p>
                  <div
                    v-if="ch32Matched"
                    class="flex items-center gap-2 rounded border border-data-500/30 bg-data-500/10 px-2.5 py-1.5 text-xs text-data-300"
                  >
                    <span>该 UID 已入库：<b>{{ ch32Matched.model }}</b></span>
                    <UButton
                      icon="i-lucide-external-link"
                      color="data"
                      variant="ghost"
                      size="xs"
                      @click="navigateTo(`/chips/${ch32Matched.id}`)"
                    >
                      打开档案
                    </UButton>
                  </div>
                </template>
                <template v-else-if="readerKind.includes('CH55x')">
                  <p class="text-xs text-ink-tertiary">
                    USB ISP：CH55x 无 SWD，走出厂 2KB BOOT（删不掉，无锁死风险）。
                    <b class="text-ink-secondary">冷启动</b>（断电状态下插 USB 上电）且 D+ 为高电平即进 BOOT
                    （BOOT 模式 USB 设备 PID=0x55E0，驱动已随官方 WCHISPTool 安装）。
                    只读 identify，不擦不写，程序原样保留；读完后芯片停在 BOOT，重新上电（不插 USB 跳线）即回用户程序。
                  </p>
                  <div
                    v-if="ch55xMatched"
                    class="flex items-center gap-2 rounded border border-data-500/30 bg-data-500/10 px-2.5 py-1.5 text-xs text-data-300"
                  >
                    <span>该 UID 已入库：<b>{{ ch55xMatched.model }}</b></span>
                    <UButton
                      icon="i-lucide-external-link"
                      color="data"
                      variant="ghost"
                      size="xs"
                      @click="navigateTo(`/chips/${ch55xMatched.id}`)"
                    >
                      打开档案
                    </UButton>
                  </div>
                </template>
                <template v-else-if="readerKind.includes('AT32')">
                  <p class="text-xs text-ink-tertiary">
                    SWD 四线：<b class="text-ink-secondary">SWDIO(PA13) / SWCLK(PA14) / GND / 3V3</b>，LinkE 自动切 DAP 模式（免驱）。
                    随时可读、无需断电重启、无需 halt，程序原样保留。
                    识别算法 = Artery 官方 AN0016（PID+系列字节→64 位 ID 查官方型号表）+ UID 96bit。
                    适用 AT32F421/F425/F403A/F407 等全系列及 GD32。
                  </p>
                  <div
                    v-if="at32Matched"
                    class="flex items-center gap-2 rounded border border-data-500/30 bg-data-500/10 px-2.5 py-1.5 text-xs text-data-300"
                  >
                    <span>该 UID 已入库：<b>{{ at32Matched.model }}</b></span>
                    <UButton
                      icon="i-lucide-external-link"
                      color="data"
                      variant="ghost"
                      size="xs"
                      @click="navigateTo(`/chips/${at32Matched.id}`)"
                    >
                      打开档案
                    </UButton>
                  </div>
                </template>
                <template v-else-if="readerKind.includes('STM32')">
                  <p class="text-xs text-ink-secondary">
                    SWD 四线：<b class="text-ink-primary">SWDIO(PA13) / SWCLK(PA14) / GND / 3V3</b>，LinkE 自动切 DAP 模式（免驱）。
                    随时可读、无需断电重启、无需 halt，程序原样保留。
                    识别 = DBGMCU DEV_ID → 家族表（UID/容量地址按官方 RM 实锤录入，F1/F4 已收录，其余家族报 DEV_ID 待补）。
                    GD32F10x 与 STM32F1 同布局同 DEV_ID，走同一分支。
                  </p>
                  <div
                    v-if="stm32Matched"
                    class="flex items-center gap-2 rounded border border-data-500/30 bg-data-500/10 px-2.5 py-1.5 text-xs text-data-300"
                  >
                    <span>该 UID 已入库：<b>{{ stm32Matched.model }}</b></span>
                    <UButton
                      icon="i-lucide-external-link"
                      color="data"
                      variant="ghost"
                      size="xs"
                      @click="navigateTo(`/chips/${stm32Matched.id}`)"
                    >
                      打开档案
                    </UButton>
                  </div>
                </template>
                <p v-else class="text-xs text-ink-secondary">
                  {{ readerKind }} 的自动读取开发中，暂不可用。
                </p>
              </div>
            </div>

            <!-- 空片擦除读取 UID 确认框 -->
            <UModal v-model:open="eraseConfirmOpen" title="空片擦除读取 UID">
              <template #body>
                <div class="space-y-2 text-sm text-ink-secondary">
                  <p>将向芯片发送擦除命令，从擦除应答取回 7 字节 UID（STC15/12/8 系列 BSL 只在擦除应答里附带 UID）。</p>
                  <ul class="list-disc space-y-1 pl-5 text-xs text-ink-secondary">
                    <li>片内<b class="text-alert-400">用户程序会被全部擦除，不可恢复</b>——仅适用于未烧程序的空片</li>
                    <li>UID 区（程序区最后 7 字节）受硬件保护，擦不掉，擦除后 UID 依然有效</li>
                    <li>读取后芯片停在 BSL，需重新上电才能运行程序</li>
                  </ul>
                </div>
              </template>
              <template #footer>
                <div class="flex justify-end gap-2">
                  <UButton color="neutral" variant="ghost" @click="eraseConfirmOpen = false">
                    取消
                  </UButton>
                  <UButton
                    icon="i-lucide-flame"
                    color="error"
                    :loading="stcReading"
                    @click="doStcRead(true)"
                  >
                    确认擦除并读取
                  </UButton>
                </div>
              </template>
            </UModal>

            <!-- 读取实时日志框（STC / CH32V 共用） -->
            <UModal v-model:open="stcLogOpen" title="读取日志" :dismissible="!stcLogBusy">
              <template #body>
                <div
                  ref="stcLogBox"
                  class="h-72 overflow-y-auto rounded bg-surface-sunken/80 p-3 font-mono text-xs leading-5 text-gain-400 whitespace-pre-wrap"
                >
                  <div v-for="(l, i) in stcLogLines" :key="i">{{ l }}</div>
                  <div v-if="stcLogBusy" class="text-ink-tertiary">…</div>
                </div>
              </template>
              <template #footer>
                <div class="flex justify-end gap-2">
                  <UButton color="neutral" variant="ghost" :disabled="stcLogBusy" @click="stcLogOpen = false">
                    关闭
                  </UButton>
                </div>
              </template>
            </UModal>
          </div>

          <!-- UID 长度 + 容量（其他类型不需要） -->
          <div v-if="form.chip_type !== 'other'" class="grid grid-cols-2 gap-4">
            <div>
              <label class="mb-1.5 block text-sm font-medium text-ink-secondary">UID 长度</label>
              <UInput
                v-model.number="form.uid_length"
                type="number"
                placeholder="8"
                class="w-full"
              />
            </div>
            <div v-if="form.chip_type === 'flash'">
              <label class="mb-1.5 block text-sm font-medium text-ink-secondary">容量</label>
              <UInput
                v-model="form.capacity"
                placeholder="如: 16Mbit / 2MB"
                class="w-full"
              />
              <p class="mt-1 text-xs text-ink-tertiary">根据 JEDEC ID 自动识别，可手动修改</p>
            </div>
          </div>

          <!-- 封装 -->
          <div>
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">封装</label>
            <UInputMenu
              v-model="form.package"
              :items="packageOptions"
              placeholder="选择封装（可输入过滤）"
              class="w-full"
            />
            <p class="mt-1 text-xs text-ink-tertiary">
              没有想要的封装？先去 <NuxtLink to="/packages" class="text-action hover:underline">封装列表</NuxtLink> 新增
            </p>
          </div>

          <!-- 库位（三级） -->
          <div>
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">库位</label>
            <div class="grid grid-cols-3 gap-2">
              <UInput
                v-model="form.location_a"
                placeholder="大箱"
                class="w-full"
              />
              <UInput
                v-model="form.location_b"
                placeholder="小箱"
                class="w-full"
              />
              <UInput
                v-model="form.location_c"
                placeholder="序号"
                class="w-full"
              />
            </div>
            <p class="mt-1 text-xs text-ink-tertiary">可选，三级容器定位：大箱 / 小箱 / 序号</p>
          </div>

          <!-- 备注 -->
          <div>
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">备注</label>
            <UTextarea
              v-model="form.note"
              placeholder="可选备注信息..."
              class="w-full"
              :rows="3"
            />
          </div>

          <!-- 提交错误 -->
          <div
            v-if="submitError"
            class="flex items-center gap-2 rounded-md bg-alert-500/10 p-3 ring-1 ring-alert-500/20"
          >
            <UIcon name="i-lucide-alert-circle" class="h-5 w-5 shrink-0 text-alert-400" />
            <span class="text-sm text-alert-300">{{ submitError }}</span>
          </div>

          <!-- 操作按钮 -->
          <div class="flex items-center justify-end gap-3 pt-2">
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              @click="resetForm"
            >
              重置
            </UButton>
            <UButton
              color="primary"
              variant="solid"
              size="sm"
              icon="i-lucide-check"
              :loading="submitting"
              :disabled="!isValid || submitting"
              @click="submit"
            >
              提交录入
            </UButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
