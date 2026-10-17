/**
 * 德佟 P2 打印机 composable（单例）
 *
 * 严格参照 DetongSDK 官方 Vue 示例的 API 用法：
 * - DTPWeb.checkServer({ callback }) 静态方法初始化
 * - getPrinters(options, callback) callback 方式获取打印机列表
 * - startJob 传 printer 参数让 SDK 自动打开
 * - action: 2 = PrevBase64 白底预览，4096 = Print 真打印
 *
 * 单例模式：整个应用只有一套状态，无论哪个组件调用 usePrinter()
 * 都返回同一个 ref 引用，避免 [id].vue 和 PrintLabelModal.vue 状态不同步。
 */

import { ref } from 'vue'

interface PrinterInfo {
  name: string
  deviceName?: string
  ip?: string
  port?: number
  type?: number
  hostname?: string
}

interface ChipLabelData {
  type: 'chip'
  id: number
  vendor?: string | null
  model: string
  jedecId?: string | null
  uid?: string | null
  capacity?: string | null
  chipType: 'flash' | 'mcu'
  location_a?: string | null
  location_b?: string | null
  location_c?: string | null
  note?: string | null
}

interface EquipmentLabelData {
  type: 'equipment'
  id: number
  brand: string | null
  model: string
  serialNumber: string | null
  status: 'normal' | 'damaged' | 'lost'
  note?: string | null
}

interface ConsumableLabelData {
  type: 'consumable'
  id: number
  brand: string | null
  model: string
  serialNumber: string | null
  barcode?: string | null
  status: 'in_use' | 'in_stock'
  location_a?: string | null
  location_b?: string | null
  location_c?: string | null
  shelf_life?: string | null
  production_date?: string | null
  exec_standard?: string | null
  net_content?: string | null
  note?: string | null
}

interface BoardLabelData {
  type: 'board'
  id: number
  brand: string | null
  model: string
  serialNumber: string | null
  status: 'pending' | 'partial' | 'done'
  chips?: string[] | null
  note?: string | null
}

/** 容器标签（大箱 / 小箱，无数据库实体，手动创建） */
interface ContainerLabelData {
  type: 'container'
  kind: 'big' | 'small'
  /** 大箱: 'A'  小箱: 'A-B' */
  name: string
  /** 可选副标题，如 "12 颗芯片" */
  subtitle?: string | null
  note?: string | null
}

type LabelData = ChipLabelData | EquipmentLabelData | ConsumableLabelData | BoardLabelData | ContainerLabelData

// ========== 模块级单例状态 ==========
const isAvailable = ref(false)
const printers = ref<PrinterInfo[]>([])
const currentPrinter = ref<any>(null)
const checking = ref(false)
const errorMsg = ref<string | null>(null)

const previewLoading = ref(false)
const previewImages = ref<string[]>([])

const printing = ref(false)
const printResult = ref<string | null>(null)

const labelWidth = ref(40)
const labelHeight = ref(30)

// 打印机硬件状态
const printerStatus = ref<number | null>(null)      // LPA_Printable 枚举值，null = 未检查
const printerStatusText = ref<string>('')            // 可读文字
const checkingStatus = ref(false)

let api: any = null
let initPromise: Promise<void> | null = null

/** 初始化：动态 import SDK（SSR 安全）+ DTPWeb.checkServer 静态方法 */
function doInit(): Promise<void> {
  if (import.meta.server) return Promise.resolve()
  if (api) return Promise.resolve()  // 已初始化
  if (initPromise) return initPromise  // 初始化中

  checking.value = true
  errorMsg.value = null

  initPromise = (async () => {
    try {
      const sdkPath = '/vendor/dtpweb/dtpweb.esm.js'
      const mod: any = await import(/* @vite-ignore */ sdkPath)
      const DTPWebClass = mod.DTPWeb
      if (!DTPWebClass) throw new Error('dtpweb SDK 加载失败')

      DTPWebClass.checkServer({
        callback: (resp: any, dtpApi: any) => {
          checking.value = false
          if (resp?.statusCode === 0) {
            api = dtpApi
            isAvailable.value = true
            refreshPrinters()
          } else {
            errorMsg.value = '未检测到 DTPWeb 打印助手，请先安装 DTPWeb-Inst'
          }
        },
      })
    } catch (err: any) {
      checking.value = false
      errorMsg.value = err?.message || 'dtpweb SDK 加载失败'
    }
  })()

  return initPromise
}

/**
 * 刷新打印机列表
 * SDK 的 getPrinters 同步返回值不是数组，必须用 callback 参数！
 * 参考官方 App.vue updatePrinterList() 方法
 */
function refreshPrinters() {
  if (!api) return
  api.getPrinters({ onlyLocal: false }, (values: any[]) => {
    if (values?.length > 0) {
      printers.value = values.map((p: any) => ({
        ...p,
      }))
      if (!currentPrinter.value) {
        currentPrinter.value = values[0]
      }
    } else {
      printers.value = []
      currentPrinter.value = null
    }
  })
}

/** 设置当前打印机（传入 SDK 原始对象） */
function selectPrinter(printerObj: any) {
  currentPrinter.value = printerObj
  // 不主动查状态（openPrinter 有延迟），等 startJob 后自动查
  if (!printerObj) {
    printerStatus.value = null
    printerStatusText.value = ''
  }
}

/**
 * 查打印机硬件状态（轻量，不主动 openPrinter）
 * SDK startJob 后会自动建立连接，此时 getParam(232) 就能拿到有效值
 * 所以在 startJob 成功后调用才靠谱
 */
function checkPrinterStatus(): number | null {
  if (!api) {
    printerStatus.value = null
    printerStatusText.value = ''
    return null
  }
  checkingStatus.value = true
  try {
    const code = api.getParam(232)  // LPA_ParamID.IsPrintable = 232
    printerStatus.value = code
    printerStatusText.value = printableText(code)
    checkingStatus.value = false
    return code
  } catch {
    printerStatus.value = null
    printerStatusText.value = ''
    checkingStatus.value = false
    return null
  }
}

/** LPA_Printable 枚举 → 可读文字 */
function printableText(code: number): string {
  switch (code) {
    case 0:   return '就绪 ✅'
    case 1:   return '正在打印...'
    case 2:   return '马达运转中...'
    case 10:  return '就绪（空闲）✅'
    case 11:  return '数据接收中...'
    case 12:  return '任务被取消'
    case 20:  return '环境不就绪'
    case 30:  return '电压过低'
    case 31:  return '电压过高'
    case 32:  return '未检测到打印头'
    case 33:  return '打印头过热'
    case 34:  return '打印机盖子打开'
    case 35:  return '缺纸'
    case 36:  return '碳带盒未锁紧'
    case 37:  return '未检测到碳带'
    case 38:  return '碳带不匹配'
    case 39:  return '打印头过冷'
    case 40:  return '碳带已用完'
    case 41:  return '色带已用完'
    case 42:  return '未检测到标签纸'
    default:  return code < 0 ? '未知状态' : `状态码 ${code}`
  }
}

/** 是否允许打印（仅 0 和 10 算可打印） */
function isPrintableNow(): boolean {
  const code = printerStatus.value
  return code === 0 || code === 10
}

/**
 * 生成预览（不耗纸）
 * action = 2 (PrevBase64) = 白底预览
 */
function generatePreview(data: LabelData): Promise<string[]> {
  return new Promise((resolve, reject) => {
    if (!api) { reject(new Error('SDK 未初始化')); return }

    previewLoading.value = true
    previewImages.value = []

    let result: any
    try {
      result = api.startJob({
        width: labelWidth.value,
        height: labelHeight.value,
        orientation: 0,
        jobName: `标签预览-${data.model}`,
        printer: currentPrinter.value,
        action: 2,
        gapType: 2,
      })
    } catch (err: any) {
      previewLoading.value = false
      reject(new Error(`启动预览任务异常: ${err?.message || err}`))
      return
    }

    if (!result) {
      previewLoading.value = false
      reject(new Error('打印机连接失败，请检查 DTPWeb-Inst 和 USB 连接'))
      return
    }

    try {
      checkPrinterStatus()  // startJob 成功，SDK 已连上，查就绪状态
      drawLabel(data)
    } catch (err: any) {
      api.abortJob()
      previewLoading.value = false
      reject(new Error(`绘制标签异常: ${err?.message || err}`))
      return
    }

    try {
      // async + timeout 必须显式传：SDK 默认走同步 XHR 且同步请求不吃超时，
      // 服务端被残留打印任务卡住时同步请求会永久挂起（表现为预览无限转圈）
      api.commitJob({ async: true, timeout: 15000 }, (res: any) => {
        previewLoading.value = false
        if (res?.previewData?.length) {
          previewImages.value = res.previewData
          resolve(res.previewData)
        } else {
          reject(new Error('预览生成失败（服务无响应/超时或返回为空），可点「刷新」恢复'))
        }
      })
    } catch (err: any) {
      api.abortJob()
      previewLoading.value = false
      reject(new Error(`commitJob 异常: ${err?.message || err}`))
    }
  })
}

/**
 * 真打印（耗纸！）
 * action = 4096 (Print)
 *
 * SDK 源码实锤：非 JSON 模式下 commitJob 回调结果只有两种：
 *   - 服务端 OK → res = {}（空对象，无任何时间字段）→ 视为打印成功
 *   - 服务端失败/超时 → res = undefined → 打印失败
 * reject 代表真正失败：SDK 连接不上 / startJob 返回空 / res 无值 / 抛异常
 */
function printNow(data: LabelData, copies = 1): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (!api) { reject(new Error('SDK 未初始化')); return }

    printing.value = true
    printResult.value = null

    let result: any
    try {
      result = api.startJob({
        width: labelWidth.value,
        height: labelHeight.value,
        orientation: 0,
        jobName: `芯片标签-${data.model}`,
        printer: currentPrinter.value,
        action: 4096,
        gapType: 2,
      })
    } catch (err: any) {
      printing.value = false
      printResult.value = `❌ 启动打印任务异常: ${err?.message || err}`
      reject(new Error(printResult.value))
      return
    }

    if (!result) {
      printing.value = false
      printResult.value = '❌ 打印机连接失败（startJob 返回空）'
      reject(new Error(printResult.value))
      return
    }

    try {
      checkPrinterStatus()  // startJob 成功，SDK 已连上，查就绪状态
      drawLabel(data)
    } catch (err: any) {
      api.abortJob()
      printing.value = false
      printResult.value = `❌ 绘制标签异常: ${err?.message || err}`
      reject(new Error(printResult.value))
      return
    }

    try {
      // async + timeout 必须显式传（同 generatePreview），否则同步 XHR 会永久挂起
      api.commitJob({ copies, async: true, timeout: 30000 }, (res: any) => {
        printing.value = false
        if (res) {
          // SDK 源码实锤：非 JSON 模式下打印任务的回调结果永远是空对象 {}（不填时间字段），
          // 服务端返回 OK（res 为 {}）即代表任务已被打印机接受处理
          printResult.value = `✅ 打印成功 (${copies} 张)`
        } else {
          printResult.value = '❌ 提交打印失败（服务无响应/超时），请检查打印机或点「刷新」重试'
        }
        resolve(printResult.value)
      })
    } catch (err: any) {
      api.abortJob()
      printing.value = false
      printResult.value = `❌ commitJob 异常: ${err?.message || err}`
      reject(new Error(printResult.value))
    }
  })
}

/** 标签绘制分发：芯片 vs 设备 vs 耗材 vs 电路板 */
function drawLabel(data: LabelData) {
  if (data.type === 'chip') drawChipLabel(data)
  else if (data.type === 'equipment') drawEquipmentLabel(data)
  else if (data.type === 'consumable') drawConsumableLabel(data)
  else if (data.type === 'board') drawBoardLabel(data)
  else drawContainerLabel(data)
}

/**
 * 动态排版：先测后画
 *
 * 核心思路：
 * 1. 收集所有要画的内容块（LayoutBlock），每块带字号、是否自动换行
 * 2. 用 api.measureText() 精确测每块在给定宽度下的真实高度（含多行自动换行）
 * 3. 根据"总内容高 + QR 占位" vs "标签可用高" 做决策：
 *    - 够空间 → QR 贴底，内容正常排版
 *    - 紧张   → QR 上浮到内容末尾
 *    - 不够   → 降级：缩小 QR / 跳过次要块 / 缩小字号
 * 4. 按规划好的参数依次 draw
 */
interface LayoutBlock {
  kind: string
  text: string
  fontHeight: number
  minHeight?: number    // 估算下限（measureText 失败时用）
  autoReturn?: 0 | 1 | 2  // 0=不换行 1=按字 2=按词
  priority?: number      // 降级时的淘汰优先级（越小越先被砍）
}

/** 用 SDK measureText 精确测一段文本的实际渲染高度（mm） */
function measureBlockHeight(block: LayoutBlock, contentW: number): number {
  if (!api) return block.minHeight ?? block.fontHeight + 0.5
  try {
    const m = api.measureText({
      text: block.text,
      fontHeight: block.fontHeight,
      width: contentW,
      autoReturn: block.autoReturn ?? 0,
    } as any)
    const h = (m as any)?.shownHeight
    if (typeof h === 'number' && h > 0) return h
  } catch { /* SDK 调用失败，回退到估算 */ }
  return block.minHeight ?? block.fontHeight + 0.5
}

/**
 * 规划并绘制：左侧内容块 + 底部 QR + 右侧类型标签
 *
 * @param blocks       所有要画的文本块（按从上到下顺序）
 * @param qrText       QR 编码内容
 * @param qrLabelText  QR 右侧显示的类型文字
 * @param w            标签宽 mm
 * @param h            标签高 mm
 * @param margin       边距 mm
 * @param align        文本水平对齐 0=左 1=中 2=右
 */
function drawDynamicLabel(
  blocks: LayoutBlock[],
  qrText: string,
  qrLabelText: string,
  w: number,
  h: number,
  margin = 1,
  align: 0 | 1 | 2 = 0,
) {
  if (!api) return
  const contentW = w - margin * 2
  const gap = 0.3  // 块间距 mm

  // === 阶段 1：测量 ===
  // 用 measureText 拿真实高度（含多行换行），不行则回退到估算
  const measured = blocks.map(b => ({ ...b, height: measureBlockHeight(b, contentW) }))
  let contentH = measured.reduce((s, b) => s + b.height + gap, 0) - gap

  // === QR 物理规划 ===
  // SDK draw2DQRCode 不传 width → 自动选最小版本（跟内容匹配）
  // 传 eccLevel → 拉高纠错等级
  //
  // 203 DPI：1mm ≈ 8px；QR module 最小 2×2px → ≈0.25mm/module
  // Chip 典型内容 36-54 B（ASCII Byte 模式）：
  //   Q 级 25% 版本 5 → 84 B 容量 → 33 module → 8.25 mm
  //   H 级 30% 版本 6 → 75 B 容量 → 37 module → 9.25 mm
  // 预留 11mm 给 QR 区（保守覆盖到版本 7，12mm 物理）
  // 降级下限 8mm（版本 3 Q 级 32B 或版本 4 H 级 34B）

  let qrReserve = 11  // QR 区预留总高 mm
  const MIN_QR_RESERVE = 8

  const availH = h - margin * 2
  const baseNeed = contentH + qrReserve + 0.5

  // === 阶段 2：决策 ===
  let final = measured

  if (baseNeed > availH) {
    // 步骤 1：缩 QR 预留（下限 8mm）
    qrReserve = Math.max(MIN_QR_RESERVE, availH - contentH - 0.5)

    // 步骤 2：还不够 → 跳过次要块（按 priority 从低到高砍）
    // model（型号）、id（数据库定位符）、loc（库位）永不砍
    let stillNeed = contentH + qrReserve + 0.5 - availH
    if (stillNeed > 0 && final.length > 1) {
      const killable = [...final]
        .filter(b => b.kind !== 'model' && b.kind !== 'id' && b.kind !== 'loc')
        .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
      for (const victim of killable) {
        final = final.filter(b => b !== victim)
        contentH = final.reduce((s, b) => s + b.height + gap, 0) - gap
        stillNeed = contentH + qrReserve + 0.5 - availH
        if (stillNeed <= 0) break
      }
    }
  }

  // === 阶段 3：绘制 ===
  api.drawRectangle({ width: w, height: h, lineWidth: 0.3 })
  let y = margin

  for (const b of final) {
    api.drawText({
      text: b.text,
      x: margin,
      y,
      width: contentW,
      height: Math.ceil(b.height) + 0.5,  // 给点余量避免最后一行被切
      fontHeight: b.fontHeight,
      horizontalAlignment: align,
      autoReturn: b.autoReturn,
    })
    y += b.height + gap
  }

  // QR 贴底（内容多则上浮），不传 width 让 SDK 自动选最小版本
  const qrAreaY = Math.max(h - margin - qrReserve, y + 0.5)

  // eccLevel: 2 = Q 级 25% 纠错（L=7%, M=15%, Q=25%, H=30%）
  // 不传 width → SDK 按默认 2px/module 自动算最小尺寸
  api.draw2DQRCode({
    text: qrText,
    x: margin,
    y: qrAreaY,
    eccLevel: 2,
  })

  // QR 右侧类型文字：垂直对齐 QR 预留区中心
  api.drawText({
    text: qrLabelText,
    x: margin + qrReserve + 1,
    y: qrAreaY + qrReserve / 2 - 1.5,
    fontHeight: 3,
    horizontalAlignment: 0,
  })
}

/** 绘制芯片标签（动态排版） */
function drawChipLabel(data: ChipLabelData) {
  if (!api) return
  const w = labelWidth.value
  const h = labelHeight.value

  const blocks: LayoutBlock[] = []
  // 优先级：数字越小降级时越先被砍
  blocks.push({ kind: 'model', text: data.model, fontHeight: 3.5, autoReturn: 1, minHeight: 3.5, priority: 99 })
  if (data.vendor) blocks.push({ kind: 'vendor', text: data.vendor, fontHeight: 2.2, priority: 5 })
  if (data.jedecId) blocks.push({ kind: 'jedec', text: `JEDEC: ${formatJedecShort(data.jedecId)}`, fontHeight: 2.2, priority: 4 })
  if (data.capacity) blocks.push({ kind: 'cap', text: data.capacity, fontHeight: 2.2, priority: 3 })
  const loc = formatLabelLocation(data.location_a, data.location_b, data.location_c)
  if (loc) blocks.push({ kind: 'loc', text: `位置: ${loc}`, fontHeight: 2.2, priority: 2 })
  // UID 不画明文，只编码进二维码（多行太占空间）
  blocks.push({ kind: 'id', text: `#${data.id}`, fontHeight: 2.2, priority: 0 })

  drawDynamicLabel(
    blocks,
    `${data.model}|${data.jedecId || ''}|${data.uid || ''}|#${data.id}`,
    data.chipType === 'flash' ? 'NOR Flash' : 'MCU',
    w, h,
  )
}

/** 绘制设备标签（动态排版） */
function drawEquipmentLabel(data: EquipmentLabelData) {
  if (!api) return
  const w = labelWidth.value
  const h = labelHeight.value

  const STATUS_TEXT: Record<string, string> = { normal: '正常', damaged: '损坏', lost: '丢失' }

  const blocks: LayoutBlock[] = []
  blocks.push({ kind: 'model', text: data.model, fontHeight: 3.5, autoReturn: 1, minHeight: 3.5, priority: 99 })
  if (data.brand) blocks.push({ kind: 'brand', text: data.brand, fontHeight: 2.2, priority: 5 })
  if (data.serialNumber) blocks.push({ kind: 'sn', text: `SN: ${data.serialNumber}`, fontHeight: 2.2, priority: 4 })
  blocks.push({ kind: 'status', text: `状态: ${STATUS_TEXT[data.status] || data.status}`, fontHeight: 2.2, priority: 3 })
  blocks.push({ kind: 'id', text: `#${data.id}`, fontHeight: 2.2, priority: 2 })

  drawDynamicLabel(
    blocks,
    `${data.brand || ''}|${data.model}|${data.serialNumber || ''}|#${data.id}`,
    '设备',
    w, h,
  )
}

/** 绘制耗材标签（动态排版） */
function drawConsumableLabel(data: ConsumableLabelData) {
  if (!api) return
  const w = labelWidth.value
  const h = labelHeight.value

  const blocks: LayoutBlock[] = []
  blocks.push({ kind: 'model', text: data.model, fontHeight: 3.5, autoReturn: 1, minHeight: 3.5, priority: 99 })
  if (data.brand) blocks.push({ kind: 'brand', text: data.brand, fontHeight: 2.2, priority: 5 })
  if (data.serialNumber) blocks.push({ kind: 'sn', text: `SN: ${data.serialNumber}`, fontHeight: 2.2, priority: 4 })
  const loc = formatLabelLocation(data.location_a, data.location_b, data.location_c)
  if (loc) blocks.push({ kind: 'loc', text: `位置: ${loc}`, fontHeight: 2.2, priority: 3 })
  // 生产日期+保质期 → 过期日期；仅生产日期 → 生产；仅保质期 → 保质期
  const expiry = calcExpiryDate(data.production_date ?? null, data.shelf_life ?? null)
  if (expiry) blocks.push({ kind: 'expiry', text: `过期: ${expiry}`, fontHeight: 2.2, priority: 4 })
  else if (data.production_date) blocks.push({ kind: 'prod', text: `生产: ${data.production_date}`, fontHeight: 2.2, priority: 2 })
  else if (data.shelf_life) blocks.push({ kind: 'shelf', text: `保质期: ${data.shelf_life}`, fontHeight: 2.2, priority: 2 })
  if (data.exec_standard) blocks.push({ kind: 'exec', text: `标准: ${data.exec_standard}`, fontHeight: 2.2, priority: 1 })
  if (data.net_content) blocks.push({ kind: 'net', text: `净含量: ${data.net_content}`, fontHeight: 2.2, priority: 1 })
  blocks.push({ kind: 'id', text: `#${data.id}`, fontHeight: 2.2, priority: 0 })

  drawDynamicLabel(
    blocks,
    `${data.brand || ''}|${data.model}|#${data.id}|${data.serialNumber || ''}`,
    '耗材',
    w, h,
  )
}

/** 绘制电路板标签（动态排版） */
function drawBoardLabel(data: BoardLabelData) {
  if (!api) return
  const w = labelWidth.value
  const h = labelHeight.value

  const STATUS_TEXT: Record<string, string> = { pending: '待拆解', partial: '部分拆解', done: '已拆解' }

  const blocks: LayoutBlock[] = []
  blocks.push({ kind: 'model', text: data.model, fontHeight: 3.5, autoReturn: 1, minHeight: 3.5, priority: 99 })
  if (data.brand) blocks.push({ kind: 'brand', text: data.brand, fontHeight: 2.2, priority: 5 })
  blocks.push({ kind: 'status', text: `状态: ${STATUS_TEXT[data.status] || data.status}`, fontHeight: 2.2, priority: 4 })
  if (data.chips?.length) {
    blocks.push({ kind: 'chips', text: data.chips.join(', '), fontHeight: 2.2, autoReturn: 1, minHeight: 2.2, priority: 3 })
  }
  blocks.push({ kind: 'id', text: `#${data.id}`, fontHeight: 2.2, priority: 2 })

  drawDynamicLabel(
    blocks,
    `${data.brand || ''}|${data.model}|${(data.chips || []).join(',')}|#${data.id}`,
    '电路板',
    w, h,
  )
}

/** 绘制容器标签（大箱 / 小箱，极简大字标签） */
function drawContainerLabel(data: ContainerLabelData) {
  if (!api) return

  const w = labelWidth.value
  const h = labelHeight.value
  const margin = 2
  let y = margin

  // 外边框
  api.drawRectangle({ width: w, height: h, lineWidth: 0.3 })

  // 顶部小标签说明
  const kindText = data.kind === 'big' ? '大箱' : '小箱'
  api.drawText({
    text: kindText,
    x: margin,
    y,
    width: w - margin * 2,
    height: 2.5,
    fontHeight: 2.2,
    horizontalAlignment: 0,
  })
  y += 2.5 + 1

  // 中间大字：容器名称（居中，大字号）
  api.drawText({
    text: data.name,
    x: margin,
    y,
    width: w - margin * 2,
    height: 12,
    fontHeight: 8,
    horizontalAlignment: 1,  // 居中
    autoReturn: 1,
  })
  y += 12 + 1

  // 底部副标题（可选，如 "12 颗芯片"）
  if (data.subtitle) {
    api.drawText({
      text: data.subtitle,
      x: margin,
      y,
      width: w - margin * 2,
      height: 3,
      fontHeight: 3,
      horizontalAlignment: 1,
    })
    y += 3 + 0.5
  }

  // 二维码：kind|name
  const qrSize = Math.min(12, w * 0.35)
  api.draw2DQRCode({
    text: `${data.kind}|${data.name}`,
    x: margin,
    y: h - qrSize - margin,
    width: qrSize,
  })
  api.drawText({
    text: kindText,
    x: margin + qrSize + 2,
    y: h - qrSize - margin + qrSize / 2 - 2,
    fontHeight: 3,
    horizontalAlignment: 0,
  })
}

/** JEDEC 格式化：C8 60 17 → C86017 */
function formatJedecShort(id: string): string {
  if (!id) return ''
  return id.replace(/\s+/g, '').toUpperCase()
}

/** 库位拼接：跳过空值，用 - 连接 */
function formatLabelLocation(a?: string | null, b?: string | null, c?: string | null): string {
  const parts = [a, b, c].filter(x => x && x.trim()).map(x => x!.trim())
  return parts.length ? parts.join('-') : ''
}

/** composable 入口：返回同一套单例状态 */
export function usePrinter() {
  return {
    isAvailable,
    checking,
    errorMsg,
    printers,
    currentPrinter,
    previewLoading,
    previewImages,
    printing,
    printResult,
    labelWidth,
    labelHeight,
    printerStatus,
    printerStatusText,
    checkingStatus,
    init: doInit,
    refreshPrinters,
    selectPrinter,
    checkPrinterStatus,
    isPrintableNow,
    generatePreview,
    printNow,
  }
}
