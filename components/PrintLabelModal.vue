<script setup lang="ts">
import type { Chip, Equipment, EquipmentStatus, Consumable, CircuitBoard } from '~~/shared/types'

const props = defineProps<{
  open: boolean
  mode: 'chip' | 'equipment' | 'consumable' | 'board' | 'container'
  chip?: Chip | null
  equipment?: Equipment | null
  consumable?: Consumable | null
  board?: CircuitBoard | null
  /** 批量耗材打印（mode='consumable' 时使用，传入后进入批量模式） */
  consumables?: Consumable[]
  /** 容器标签参数（仅 mode='container' 时使用） */
  containerKind?: 'big' | 'small'
  containerName?: string
  containerSubtitle?: string | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const STATUS_TEXT: Record<EquipmentStatus, string> = {
  normal: '正常',
  damaged: '损坏',
  lost: '丢失',
}

// v-model:open 需要一个可写的计算属性
const modalOpen = computed({
  get: () => props.open,
  set: (val: boolean) => emit('update:open', val),
})

// 批量模式：传入了 consumables 数组
const isBatch = computed(() => !!props.consumables?.length)

// 批量模式下的 LabelData 列表（复用 buildLabelData 逐项转换）
const batchDataList = computed(() => {
  if (!isBatch.value || props.mode !== 'consumable') return []
  return props.consumables!.map(c => buildLabelData(c))
})

// 根据当前模式获取显示名称
const displayName = computed(() => {
  if (isBatch.value) return `批量打印 (${batchDataList.value.length} 项耗材)`
  if (props.mode === 'chip') return props.chip?.model || ''
  if (props.mode === 'equipment') {
    const e = props.equipment
    if (!e) return ''
    return e.brand ? `${e.brand} ${e.model}` : e.model
  }
  if (props.mode === 'consumable') {
    const c = props.consumable
    if (!c) return ''
    return c.brand ? `${c.brand} ${c.model}` : c.model
  }
  if (props.mode === 'board') {
    const b = props.board
    if (!b) return ''
    return b.brand ? `${b.brand} ${b.model}` : b.model
  }
  if (props.mode === 'container') {
    const kindLabel = props.containerKind === 'big' ? '大箱' : '小箱'
    return `${kindLabel} ${props.containerName || ''}`
  }
  return ''
})

const {
  isAvailable,
  checking,
  errorMsg,
  printers,
  previewLoading,
  previewImages,
  printing,
  printResult,
  labelWidth,
  labelHeight,
  printerStatus,
  printerStatusText,
  checkingStatus,
  init,
  refreshPrinters,
  selectPrinter,
  checkPrinterStatus,
  isPrintableNow,
  generatePreview,
  printNow,
  printBatch,
} = usePrinter()

// 打印份数
const copies = ref(1)
// 是否已经生成预览
const previewReady = ref(false)

// 选中打印机的 name（供下拉显示用）
const selectedPrinterName = ref<string>('')

// 状态分级：ok / busy / error / unknown
const statusLevel = computed(() => {
  const code = printerStatus.value
  if (code === null || checkingStatus.value) return 'unknown'
  if (code === 0 || code === 10) return 'ok'
  if (code >= 1 && code <= 12) return 'busy'
  return 'error'
})

// 监听对话框打开，自动初始化 DTPWeb SDK
watch(() => props.open, (val) => {
  if (val) {
    // 清掉上次会话残留的打印结果横幅（printResult 是 usePrinter 模块级状态，跨弹窗持久）
    printResult.value = null
    if (!isAvailable.value) init()
  }
})

// 选中第一个可用打印机
// immediate: 打印机列表是 usePrinter 模块级状态，跨页面保持已填充状态，
// 新弹窗实例挂载时列表可能早已就绪（length 不再变化），不加 immediate 永远不会触发
watch(() => printers.value.length, (len) => {
  if (len > 0 && !selectedPrinterName.value) {
    selectedPrinterName.value = printers.value[0].name
    // 同时设到 currentPrinter
    selectPrinter(printers.value[0])
  }
}, { immediate: true })

// 选中打印机变化 → 更新 currentPrinter（存 SDK 原始对象供 startJob 使用）
watch(selectedPrinterName, (name) => {
  if (!name || printers.value.length === 0) return
  const p = printers.value.find(x => x.name === name)
  if (p) selectPrinter(p)
})

// 判断当前模式下数据是否就绪（批量模式取第一项用于预览）
const currentData = computed(() => {
  if (isBatch.value) return props.consumables?.[0] ?? null
  if (props.mode === 'chip' && props.chip) return props.chip
  if (props.mode === 'equipment' && props.equipment) return props.equipment
  if (props.mode === 'consumable' && props.consumable) return props.consumable
  if (props.mode === 'board' && props.board) return props.board
  if (props.mode === 'container' && props.containerName) return { __container: true }
  return null
})

// 打印机就绪 + 有数据 → 自动生成预览（零耗纸）
const autoPreviewing = ref(false)
const lastOpenTime = ref(0)
watch(
  [() => props.open, currentData, () => printers.value.length],
  ([open, data, plen], [oldOpen]) => {
    // 只有从"关闭→打开"才重置，避免同一弹窗内重复触发
    if (open && !oldOpen) {
      lastOpenTime.value = Date.now()
      previewReady.value = false
      previewImages.value = []
    }
    if (!open || !data || plen === 0) return
    if (!selectedPrinterName.value) return  // 等自动选中第一个打印机
    if (previewReady.value || previewLoading.value || autoPreviewing.value) return

    autoPreviewing.value = true
    generatePreview(buildLabelData(data)).then(() => {
      previewReady.value = true
    }).catch(() => {
      // 自动预览失败不阻断用户手动点
    }).finally(() => {
      autoPreviewing.value = false
    })
  },
)

// 根据 mode 构建传给 SDK 的 LabelData
function buildLabelData(data: any) {
  if (props.mode === 'chip') {
    const c = data as Chip
    return {
      type: 'chip' as const,
      id: c.id,
      vendor: c.vendor,
      model: c.model,
      jedecId: c.jedec_id,
      uid: c.uid,
      capacity: c.capacity,
      package: c.package,
      chipType: c.chip_type,
      chipCategory: c.chip_category,
      location_a: c.location_a,
      location_b: c.location_b,
      location_c: c.location_c,
      note: c.note,
    }
  } else if (props.mode === 'equipment') {
    const e = data as Equipment
    return {
      type: 'equipment' as const,
      id: e.id,
      brand: e.brand,
      model: e.model,
      serialNumber: e.serial_number,
      status: e.status,
      note: e.note,
    }
  } else if (props.mode === 'consumable') {
    const c = data as Consumable
    return {
      type: 'consumable' as const,
      id: c.id,
      brand: c.brand,
      model: c.model,
      serialNumber: c.serial_number,
      barcode: c.barcode,
      status: c.status,
      location_a: c.location_a,
      location_b: c.location_b,
      location_c: c.location_c,
      shelf_life: c.shelf_life,
      production_date: c.production_date,
      expiry_date: c.expiry_date,
      batch_number: c.batch_number,
      exec_standard: c.exec_standard,
      net_content: c.net_content,
      note: c.note,
    }
  } else if (props.mode === 'board') {
    const b = data as CircuitBoard
    return {
      type: 'board' as const,
      id: b.id,
      brand: b.brand,
      model: b.model,
      serialNumber: b.serial_number,
      status: b.status,
      chips: b.chips,
      note: b.note,
    }
  } else {
    // container 模式
    return {
      type: 'container' as const,
      kind: (props.containerKind || 'big') as 'big' | 'small',
      name: props.containerName || '',
      subtitle: props.containerSubtitle ?? null,
    }
  }
}

// 真打印（按钮 / Enter）：直接打，免确认（纸多随便造）
async function handlePrint() {
  if (!currentData.value || printing.value) return
  if (isBatch.value) {
    try {
      await printBatch(batchDataList.value, copies.value)
      setTimeout(() => emit('update:open', false), 800)
    } catch (err: any) {
      alert('批量打印失败: ' + (err?.message || err))
    }
  } else {
    try {
      await printNow(buildLabelData(currentData.value), copies.value)
      setTimeout(() => emit('update:open', false), 800)
    } catch (err: any) {
      alert('打印失败: ' + (err?.message || err))
    }
  }
}

// Enter 直接打印：预览就绪 + 打印机可用时，按 Enter = 点打印按钮
function onKeydown(e: KeyboardEvent) {
  if (!modalOpen.value || e.key !== 'Enter' || e.repeat) return
  // 不拦截下拉菜单的 Enter 选值
  const el = e.target as HTMLElement | null
  if (el?.closest('select, [role="listbox"], [role="option"]')) return
  if (printing.value || !previewReady.value || printers.value.length === 0 || !isPrintableNow()) return
  handlePrint()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

// 关闭
function close() {
  emit('update:open', false)
}
</script>

<template>
  <UModal v-model:open="modalOpen" :title="`打印标签 - ${displayName}`" :close-on-escape="true" :close-on-overlay-click="false">
    <template #body>
      <div v-if="!currentData" class="py-4 text-center text-ink-tertiary">
        请先选择{{ mode === 'chip' ? '一颗芯片' : mode === 'equipment' ? '一个设备' : mode === 'consumable' ? '一个耗材' : mode === 'board' ? '一块电路板' : '容器参数' }}
      </div>

      <div v-else class="space-y-4">
        <!-- 打印机状态 -->
        <div class="rounded-lg bg-surface-muted p-4 ring-1 ring-line">
          <div class="flex items-center gap-2">
            <UIcon
              :name="checking ? 'i-lucide-loader-2' : isAvailable ? 'i-lucide-printer' : 'i-lucide-alert-triangle'"
              :class="['h-4 w-4', checking ? 'animate-spin text-notice-400' : isAvailable ? 'text-action' : 'text-alert-400']"
            />
            <span class="text-sm text-ink-secondary">
              <template v-if="checking">检测打印助手...</template>
              <template v-else-if="isAvailable">DTPWeb 已就绪</template>
              <template v-else>{{ errorMsg || '未检测到打印助手' }}</template>
            </span>
          </div>

          <!-- 打印机选择 -->
          <div v-if="isAvailable" class="mt-3 flex gap-2">
            <USelect
              v-model="selectedPrinterName"
              :items="printers.map(p => ({ label: p.deviceName || p.name, value: p.name }))"
              placeholder="选择打印机"
              size="sm"
              class="flex-1"
            />
            <UButton
              size="sm"
              color="neutral"
              variant="outline"
              :loading="checkingStatus"
              @click="checkPrinterStatus()"
            >
              检查
            </UButton>
            <UButton
              size="sm"
              color="neutral"
              variant="outline"
              :loading="checking"
              @click="refreshPrinters()"
            >
              刷新
            </UButton>
          </div>

          <div v-if="isAvailable && printers.length === 0" class="mt-2 text-xs text-notice-400">
            未找到打印机，请检查 USB 连接
          </div>

          <!-- 打印机硬件状态徽章 -->
          <div
            v-if="isAvailable && printers.length > 0 && (printerStatus !== null || printerStatusText)"
            class="mt-3 flex items-center gap-2 rounded-md px-3 py-2 text-xs"
            :class="statusLevel === 'ok' ? 'bg-gain-500/10 text-gain-300 ring-1 ring-gain-500/20'
              : statusLevel === 'busy' ? 'bg-notice-500/10 text-notice-300 ring-1 ring-notice-500/20'
              : statusLevel === 'unknown' ? 'bg-surface-muted/10 text-ink-secondary ring-1 ring-surface-muted/20'
              : 'bg-alert-500/10 text-alert-300 ring-1 ring-alert-500/20'"
          >
            <UIcon
              :name="statusLevel === 'ok' ? 'i-lucide-check-circle-2'
                : statusLevel === 'busy' ? 'i-lucide-loader-2'
                : statusLevel === 'unknown' ? 'i-lucide-help-circle'
                : 'i-lucide-x-circle'"
              :class="['h-3.5 w-3.5', statusLevel === 'busy' ? 'animate-spin' : '']"
            />
            <span>{{ printerStatusText }}</span>
            <span v-if="printerStatus !== null && statusLevel !== 'ok'" class="opacity-70">({{ printerStatus }})</span>
          </div>
        </div>

        <!-- 标签参数 -->
        <div class="rounded-lg bg-surface-muted p-4 ring-1 ring-line">
          <div class="mb-2 text-sm font-medium text-ink-secondary">标签尺寸</div>
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-1.5">
              <UInput v-model.number="labelWidth" type="number" min="10" max="100" step="1" class="w-20 text-center" />
              <span class="text-xs text-ink-tertiary">mm 宽</span>
            </div>
            <div class="flex items-center gap-1.5">
              <UInput v-model.number="labelHeight" type="number" min="5" max="100" step="1" class="w-20 text-center" />
              <span class="text-xs text-ink-tertiary">mm 高</span>
            </div>
            <span class="text-xs text-ink-tertiary">·</span>
            <div class="flex items-center gap-1.5">
              <span class="text-xs text-ink-tertiary">份数</span>
              <UInput v-model.number="copies" type="number" min="1" max="99" step="1" class="w-16 text-center" />
            </div>
          </div>
        </div>

        <!-- 预览区 -->
        <div class="rounded-lg bg-surface-muted p-4 ring-1 ring-line">
          <div class="mb-2 flex items-center justify-between">
            <span class="text-sm font-medium text-ink-secondary">标签预览</span>
            <div class="flex items-center gap-2">
              <span v-if="isBatch" class="text-xs text-notice-400/80">
                仅预览第 1 项，共 {{ batchDataList.length }} 项
              </span>
              <span v-if="previewImages.length" class="text-xs text-gain-400">
                ✅ 预览已生成
              </span>
            </div>
          </div>

          <!-- 预览图片 -->
          <div
            v-if="previewImages.length"
            class="flex min-h-[160px] items-center justify-center rounded-md bg-surface-sunken/50 p-4"
          >
            <img
              v-for="(src, i) in previewImages"
              :key="i"
              :src="src"
              :alt="`预览 ${i + 1}`"
              class="max-h-48 rounded border border-line"
            />
          </div>

          <!-- 加载中 -->
          <div
            v-else-if="previewLoading"
            class="flex min-h-[160px] items-center justify-center rounded-md bg-surface-sunken/50"
          >
            <UIcon name="i-lucide-loader-2" class="h-6 w-6 animate-spin text-action" />
            <span class="ml-2 text-sm text-ink-secondary">正在生成预览...</span>
          </div>

          <!-- 空状态 -->
          <div
            v-else
            class="flex min-h-[160px] flex-col items-center justify-center rounded-md bg-surface-sunken/50"
          >
            <UIcon name="i-lucide-eye-off" class="h-8 w-8 text-ink-tertiary" />
            <p class="mt-2 text-sm text-ink-tertiary">正在自动生成预览...</p>
          </div>
        </div>

        <!-- 打印结果 -->
        <div
          v-if="printResult"
          class="rounded-md p-3 text-sm"
          :class="printResult.includes('失败')
            ? 'bg-alert-500/10 text-alert-300 ring-1 ring-alert-500/20'
            : 'bg-gain-500/10 text-gain-300 ring-1 ring-gain-500/20'"
        >
          {{ printResult }}
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex items-center justify-between gap-2">
        <div
          v-if="isAvailable && printers.length > 0 && statusLevel === 'error'"
          class="text-xs text-alert-400"
        >
          ⛔ {{ printerStatusText }} — 请排除故障后再打印
        </div>
        <div
          v-else-if="isAvailable && printers.length > 0 && statusLevel === 'busy'"
          class="text-xs text-notice-400/80"
        >
          ⏳ {{ printerStatusText }}
        </div>
        <div v-else class="text-xs text-ink-tertiary">
          预览就绪后点按钮或按 Enter 直接打印（免确认）
        </div>
        <div class="flex gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="close"
          >
            关闭
          </UButton>
          <UButton
            color="notice"
            variant="solid"
            icon="i-lucide-printer"
            :loading="printing"
            :disabled="!previewReady || printers.length === 0 || !isPrintableNow()"
            @click="handlePrint"
          >
            打印{{ isBatch ? ` (${batchDataList.length}项×${copies}份)` : ` (${copies}张)` }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
