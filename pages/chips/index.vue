<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { Chip, Stats } from '~~/shared/types'

definePageMeta({
  title: '芯片列表'
})

const UBadge = resolveComponent('UBadge')
const UButton = resolveComponent('UButton')
const ULink = resolveComponent('ULink')
const BrandLogo = resolveComponent('BrandLogo')
const PackageImage = resolveComponent('PackageImage')

const route = useRoute()
// 容器标签二维码会带 ?search=容器名，进入列表时自动按该关键字筛选
const search = ref(String(route.query.search || ''))
const modelFilter = ref<string | undefined>(undefined)
const typeFilter = ref<string | undefined>(undefined)
const chips = ref<Chip[]>([])
const pending = ref(false)
const fetchError = ref<any>(null)

async function fetchChips() {
  pending.value = true
  fetchError.value = null
  try {
    const params: Record<string, string> = {}
    if (search.value) params.search = search.value
    if (modelFilter.value) params.model = modelFilter.value
    if (typeFilter.value) params.chip_type = typeFilter.value
    chips.value = await $fetch<Chip[]>('/api/chips', { params })
  } catch (e: any) {
    fetchError.value = e
  } finally {
    pending.value = false
  }
}

const statsData = ref<Stats>({ total: 0, models: [] })

async function fetchStats() {
  try {
    statsData.value = await $fetch<Stats>('/api/stats')
  } catch {
    // ignore
  }
}

onMounted(() => {
  fetchChips()
  fetchStats()
  // 从 sessionStorage 恢复识别结果（防止页面刷新丢失）
  try {
    const saved = sessionStorage.getItem('chips-identify-result')
    if (saved) {
      identifyResult.value = JSON.parse(saved)
    }
  } catch {
    // ignore
  }
})

const modelItems = computed(() => [
  { label: '全部型号', value: 'all' },
  ...(statsData.value?.models?.map(m => ({ label: `${m.model} (${m.count})`, value: m.model })) ?? [])
])

const typeItems = computed(() => [
  { label: '全部类型', value: 'all' },
  { label: 'Flash 存储', value: 'flash' },
  { label: 'MCU 单片机', value: 'mcu' },
  { label: '其他', value: 'other' }
])

function onModelChange(val: string | undefined) {
  modelFilter.value = (val === 'all' || !val) ? undefined : val
  fetchChips()
}

function onTypeChange(val: string | undefined) {
  typeFilter.value = (val === 'all' || !val) ? undefined : val
  fetchChips()
}

function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null
  return ((...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }) as T
}

const fetchChipsDebounced = debounce(fetchChips, 300)
watch(search, () => {
  fetchChipsDebounced()
})

function chipTypeBadge(type: string) {
  const meta: Record<string, { color: any; label: string }> = {
    flash: { color: 'data', label: 'Flash' },
    mcu: { color: 'special', label: 'MCU' },
    other: { color: 'neutral', label: '其他' }
  }
  const m = meta[type] ?? meta.flash
  return h(UBadge, {
    color: m.color,
    variant: 'subtle',
    size: 'xs'
  }, () => m.label)
}

function chipTypeLabel(type?: string | null) {
  return type === 'mcu' ? 'MCU' : type === 'other' ? '其他' : 'Flash'
}

function formatLocation(a?: string | null, b?: string | null, c?: string | null): string {
  const parts = [a, b, c].filter(x => x && x.trim()).map(x => x!.trim())
  return parts.length ? parts.join('-') : '-'
}

const columns: TableColumn<Chip>[] = [
  {
    accessorKey: 'vendor',
    header: '厂商',
    cell: ({ row }) => {
      const v = row.getValue('vendor') as string | null
      const name = normalizeVendor(v)
      if (!name) return h('span', { class: 'text-xs text-ink-tertiary' }, '-')
      // logo + 规范名，点击进品牌详情页
      return h('a', {
        href: `/brands/${encodeURIComponent(name)}`,
        class: 'inline-flex items-center gap-1.5 text-xs text-notice-400 hover:text-notice-300',
        onClick: (e: Event) => e.stopPropagation()
      }, [
        h(BrandLogo, { vendor: v }),
        h('span', name)
      ])
    }
  },
  {
    accessorKey: 'model',
    header: '型号',
    cell: ({ row }) => h('div', { class: 'flex items-center gap-2' }, [
      h(ULink, {
        to: `/chips/${row.original.id}`,
        class: 'font-medium text-action hover:text-data-300'
      }, () => row.getValue('model') || '(未知)')
    ])
  },
  {
    accessorKey: 'chip_type',
    header: '类型',
    cell: ({ row }) => {
      const type = (row.getValue('chip_type') || 'flash') as string
      // chip_category 不是独立列，row.getValue 取不到，需从原始行数据取
      const cat = (row.original as Chip).chip_category
      // 已选二级分类的「其他」芯片，直接显示分类路径，不再显示「其他」
      if (type === 'other' && cat) {
        const qty = (row.original as Chip).qty_per_bag ?? 1
        return h('span', { class: 'text-xs text-ink-secondary' }, [
          categoryPath(cat),
          qty > 1 ? h('span', { class: 'ml-1 text-notice-400' }, `×${qty}`) : null
        ])
      }
      return chipTypeBadge(type)
    }
  },
  {
    accessorKey: 'uid',
    header: 'UID',
    cell: ({ row }) => {
      const uid = row.getValue('uid') as string | null
      // Flash / MCU 无 UID 时显示 "/"（出厂无 UID，如旺宏 MX25）；其他类型 UID 可选，留空
      const text = uid ? truncateUid(uid, 16) : ((row.original as Chip).chip_type !== 'other' ? '/' : '')
      return h('span', {
        class: 'font-mono text-xs text-action',
        title: uid ?? undefined
      }, text)
    }
  },
  {
    accessorKey: 'jedec_id',
    header: 'JEDEC ID',
    cell: ({ row }) => h('span', { class: 'font-mono text-xs text-ink-secondary' }, formatJedecId(row.getValue('jedec_id')) || '-')
  },
  {
    accessorKey: 'capacity',
    header: '容量',
    cell: ({ row }) => {
      const type = row.getValue('chip_type')
      const cap = row.getValue('capacity') as string | null
      const val = (type === 'mcu' || type === 'other') ? '/' : (cap || '-')
      return h('span', { class: 'text-ink-secondary' }, val)
    }
  },
  {
    accessorKey: 'package',
    header: '封装',
    cell: ({ row }) => {
      const p = row.getValue('package') as string | null
      const name = normalizePackage(p)
      if (!name) return h('span', { class: 'text-xs text-ink-tertiary' }, '-')
      // 封装图 + 规范名，点击进封装详情页
      return h('a', {
        href: `/packages/${encodeURIComponent(name)}`,
        class: 'inline-flex items-center gap-1.5 text-xs text-region-400 hover:text-region-300',
        onClick: (e: Event) => e.stopPropagation()
      }, [
        h(PackageImage, { pkg: p }),
        h('span', name)
      ])
    }
  },
  {
    accessorKey: 'location_a',
    header: '库位',
    cell: ({ row }) => h('span', { class: 'text-xs text-ink-secondary' },
      formatLocation(row.getValue('location_a'), row.getValue('location_b'), row.getValue('location_c')))
  },
  {
    id: 'actions',
    header: '操作',
    meta: { class: { th: 'text-right', td: 'text-right' } },
    cell: ({ row }) => h('div', { class: 'flex justify-end gap-1' }, [
      h(UButton, {
        icon: 'i-lucide-pencil',
        color: 'neutral',
        variant: 'ghost',
        size: 'xs',
        label: '编辑',
        onClick: (e: Event) => { e.stopPropagation(); openEditModal(row.original) }
      }),
      h(UButton, {
        icon: 'i-lucide-trash-2',
        color: 'error',
        variant: 'ghost',
        size: 'xs',
        label: '删除',
        onClick: (e: Event) => { e.stopPropagation(); openDeleteModal(row.original) }
      })
    ])
  }
]

function handleRowClick(row: Chip) {
  navigateTo(`/chips/${row.id}`)
}

// ---- 芯片识别 ----
interface IdentifyResult {
  matched: boolean
  match_by: 'uid' | 'jedec_id' | null
  reason?: string
  chip?: Chip
  candidates?: { id: number; model: string; jedec_id: string; uid: string; chip_type?: string }[]
}

const identifying = ref(false)
const identifyResult = ref<IdentifyResult | null>(null)
// 标记是否由用户主动关闭（不删除 sessionStorage）
let userDismissedIdentify = false

// 识别结果变化时保存到 sessionStorage（仅在非用户关闭时更新）
watch(identifyResult, (val) => {
  if (userDismissedIdentify) {
    // 用户主动关闭，清除 sessionStorage
    try { sessionStorage.removeItem('chips-identify-result') } catch { /* ignore */ }
    userDismissedIdentify = false
    return
  }
  try {
    if (val) {
      sessionStorage.setItem('chips-identify-result', JSON.stringify(val))
    }
  } catch {
    // ignore
  }
})

async function identifyChip() {
  identifying.value = true
  identifyResult.value = null
  try {
    const probe = await $fetch('/api/probe', { method: 'POST' })
    if (probe.error) {
      identifyResult.value = { matched: false, match_by: null, reason: probe.error }
      return
    }
    // 根据 JEDEC ID 判断芯片类型
    const jedecId = (probe.jedec_id || '').trim()
    const chipType = jedecId ? 'flash' : 'mcu'
    const result = await $fetch<IdentifyResult>('/api/identify', {
      method: 'POST',
      body: {
        jedec_id: probe.jedec_id,
        uid: probe.uid,
        uid_length: probe.uid_length,
        chip_type: chipType
      }
    })
    identifyResult.value = result
  } catch (e: any) {
    identifyResult.value = {
      matched: false,
      match_by: null,
      reason: e.data?.message || e.message || '识别失败'
    }
  } finally {
    identifying.value = false
  }
}

// ---- 编辑 ----
const showEditModal = ref(false)
const editing = ref(false)
const editError = ref<string | null>(null)
const editForm = reactive<Record<string, any>>({})

// 品牌选项：内置 + 手动添加的品牌；编辑回显时当前值不在列表则前置兜底
const { data: brandList } = await useFetch<{ name: string }[]>('/api/brands')
const brandOptions = computed(() => {
  const names = (brandList.value ?? []).map(b => b.name)
  const cur = editForm.vendor?.trim()
  if (cur && !names.includes(cur)) names.unshift(cur)
  return names
})

// 封装选项：内置 + 手动添加的封装；编辑回显时当前值不在列表则前置兜底
const { data: packageList } = await useFetch<{ name: string }[]>('/api/packages')
const packageOptions = computed(() => {
  const names = (packageList.value ?? []).map(p => p.name)
  const cur = editForm.package?.trim()
  if (cur && !names.includes(cur)) names.unshift(cur)
  return names
})

// 芯片类型（两级，仅「其他」使用）
interface CategoryItem { id: number, name: string, parent_id: number | null, chip_count: number }
const { data: categoryList } = await useFetch<CategoryItem[]>('/api/chip-categories')
const categoryRoots = computed(() =>
  (categoryList.value ?? [])
    .filter(c => c.parent_id === null)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
)
const rootOptions = computed(() => categoryRoots.value.map(c => c.name))

// 编辑时选中的一级分类（只用于筛二级，不入库）
const editRoot = ref('')
const categoryOptions = computed(() => {
  const root = categoryRoots.value.find(c => c.name === editRoot.value)
  if (!root) return []
  const names = (categoryList.value ?? [])
    .filter(c => c.parent_id === root.id)
    .map(c => c.name)
    .sort((a, b) => a.localeCompare(b, 'zh'))
  const cur = String(editForm.chip_category ?? '').trim()
  if (cur && !names.includes(cur)) names.unshift(cur)
  return names
})

// 列表展示：二级分类 → “一级 / 二级”
const categoryById = computed(() => new Map((categoryList.value ?? []).map(c => [c.id, c])))
function categoryPath(name: string | null) {
  const leaf = (categoryList.value ?? []).find(c => c.name === name)
  if (!leaf) return name || ''
  const parent = leaf.parent_id ? categoryById.value.get(leaf.parent_id) : null
  return parent ? `${parent.name} / ${leaf.name}` : leaf.name
}

// 切换一级分类时，已选二级不在新范围则清空
watch(editRoot, () => {
  if (editForm.chip_category && !categoryOptions.value.includes(editForm.chip_category)) {
    editForm.chip_category = ''
  }
})
const editId = ref<number | null>(null)

// 库位自动序号（大箱+小箱填齐、序号为空时触发）
let editSeqPromise: Promise<void> | null = null
async function tryEditAutoSeq() {
  if (!editForm.location_a?.trim() || !editForm.location_b?.trim() || editForm.location_c?.trim()) return
  if (editSeqPromise) return
  editSeqPromise = (async () => {
    try {
      const rows: any[] = await $fetch('/api/chips', {
        params: { location_a: editForm.location_a.trim(), location_b: editForm.location_b.trim() }
      })
      let maxN = 0
      for (const r of rows) {
        if (editId.value && r.id === editId.value) continue  // 排除自身
        const n = parseInt(r.location_c, 10)
        if (!isNaN(n) && n > maxN) maxN = n
      }
      if (!editForm.location_c?.trim()) editForm.location_c = String(maxN + 1)
    } catch { /* 忽略 */ }
    editSeqPromise = null
  })()
}
watch(() => [editForm.location_a, editForm.location_b] as const, () => tryEditAutoSeq())

function openEditModal(chip: Chip) {
  editId.value = chip.id
  const leaf = (categoryList.value ?? []).find(c => c.name === chip.chip_category)
  editRoot.value = leaf?.parent_id
    ? categoryById.value.get(leaf.parent_id)?.name ?? ''
    : ''
  Object.assign(editForm, chip)
  editForm.qty_per_bag = chip.qty_per_bag ?? 1
  editError.value = null
  showEditModal.value = true
}

async function confirmEdit() {
  if (!editId.value) return
  if (editForm.chip_type === 'other') {
    if (!editRoot.value) {
      editError.value = '请选择一级分类'
      return
    }
    if (!String(editForm.chip_category ?? '').trim()) {
      editError.value = '请选择二级分类'
      return
    }
  }
  editing.value = true
  editError.value = null
  try {
    const body: Record<string, any> = {}
    if (editForm.vendor !== undefined) {
      const v = editForm.vendor
      body.vendor = (v == null || v === '') ? null : v.trim()
    }
    if (editForm.model !== undefined) body.model = editForm.model
    if (editForm.chip_type !== undefined) body.chip_type = editForm.chip_type
    if (editForm.jedec_id !== undefined) body.jedec_id = editForm.jedec_id
    if (editForm.uid !== undefined) body.uid = editForm.uid
    if (editForm.uid_length !== undefined) body.uid_length = Number(editForm.uid_length)
    if (editForm.capacity !== undefined) {
      const v = editForm.capacity
      body.capacity = (v == null || v === '') ? null : v
    }
    if (editForm.package !== undefined) {
      const v = editForm.package
      body.package = (v == null || v === '') ? null : v.trim()
    }
    if (editForm.chip_category !== undefined || editForm.chip_type !== undefined) {
      body.chip_category = editForm.chip_type === 'other'
        ? String(editForm.chip_category ?? '').trim()
        : null
    }
    // 单包颗数：仅「其他」类型 + 无 UID 有效，服务端也会兜底
    body.qty_per_bag = editForm.chip_type === 'other' && (!String(editForm.uid ?? '').trim() || isNoUid(String(editForm.uid)))
      ? (Number(editForm.qty_per_bag) || 1)
      : 1
    if (editForm.location_a !== undefined) {
      const v = editForm.location_a
      body.location_a = (v == null || v === '') ? null : v.trim()
    }
    if (editForm.location_b !== undefined) {
      const v = editForm.location_b
      body.location_b = (v == null || v === '') ? null : v.trim()
    }
    if (editForm.location_c !== undefined) {
      const v = editForm.location_c
      body.location_c = (v == null || v === '') ? null : v.trim()
    }
    if (editForm.note !== undefined) {
      const v = editForm.note
      body.note = (v == null || v === '') ? null : v
    }

    await $fetch(`/api/chips/${editId.value}`, {
      method: 'PUT',
      body
    })
    showEditModal.value = false
    await fetchChips()
  } catch (err: any) {
    editError.value = err?.statusMessage || err?.message || '保存失败'
  } finally {
    editing.value = false
  }
}

// ---- 删除芯片 ----
const showDeleteModal = ref(false)
const deleting = ref(false)
const deleteError = ref<string | null>(null)
const chipToDelete = ref<Chip | null>(null)

// ---- 容器标签 ----
const showContainerParamModal = ref(false)
const showContainerPrintModal = ref(false)
const containerForm = reactive({
  kind: 'big' as 'big' | 'small',
  name: '',
  subtitle: ''
})
function openContainerPrint() {
  containerForm.kind = 'big'
  containerForm.name = ''
  containerForm.subtitle = ''
  showContainerParamModal.value = true
}
function confirmContainerParam() {
  if (!containerForm.name.trim()) return
  showContainerParamModal.value = false
  showContainerPrintModal.value = true
}

// ---- 核查厂商 ----
const vendorChecking = ref(false)
const vendorCheckResults = ref<any[]>([])
const vendorCheckSummary = ref<{ total: number; autoFillCount: number; conflictCount: number; unknownCount: number } | null>(null)
const showVendorModal = ref(false)

async function checkVendors() {
  vendorChecking.value = true
  try {
    const data = await $fetch('/api/admin/backfill-vendors', { method: 'POST' })
    vendorCheckSummary.value = {
      total: data.total ?? data.results?.length ?? 0,
      autoFillCount: data.autoFillCount ?? data.updated ?? 0,
      conflictCount: data.conflictCount ?? 0,
      unknownCount: data.unknownCount ?? 0,
    }
    vendorCheckResults.value = data.results || []
    showVendorModal.value = true
  } catch (err: any) {
    alert('核查失败: ' + (err?.statusMessage || err?.message))
  } finally {
    vendorChecking.value = false
  }
}

async function applyVendorAutoFill() {
  if (!confirm('确认自动填充所有"可自动填入"的空厂商吗？\n(冲突和未知的不会动)')) return
  vendorChecking.value = true
  try {
    const data = await $fetch('/api/admin/backfill-vendors', { method: 'POST', body: { apply: true } })
    await fetchChips()
    vendorCheckSummary.value = {
      total: data.results?.length ?? 0,
      autoFillCount: data.updated ?? 0,
      conflictCount: data.conflictCount ?? 0,
      unknownCount: data.unknownCount ?? 0,
    }
    vendorCheckResults.value = data.results || []
  } catch (err: any) {
    alert('回填失败: ' + (err?.statusMessage || err?.message))
  } finally {
    vendorChecking.value = false
  }
}

function vendorStatusBadge(status: string) {
  const map: Record<string, { text: string; cls: string }> = {
    ok:        { text: '✓ 已正确', cls: 'bg-gain-500/10 text-gain-300 ring-gain-500/20' },
    ok_manual: { text: '✓ 手动值', cls: 'bg-gain-500/10 text-gain-300 ring-gain-500/20' },
    auto_fill: { text: '可自动填', cls: 'bg-action/10 text-data-300 ring-data-500/20' },
    conflict:  { text: '⚠ 冲突',  cls: 'bg-notice-500/10 text-notice-300 ring-notice-500/20' },
    unknown:   { text: '✗ 未知',  cls: 'bg-alert-500/10 text-alert-300 ring-alert-500/20' },
  }
  const m = map[status] || { text: status, cls: 'bg-surface-muted/10 text-ink-secondary' }
  return h('span', {
    class: ['inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ring-1', m.cls]
  }, m.text)
}

function openDeleteModal(chip: Chip) {
  chipToDelete.value = chip
  deleteError.value = null
  showDeleteModal.value = true
}

async function confirmDelete() {
  if (!chipToDelete.value) return
  deleting.value = true
  deleteError.value = null
  try {
    await $fetch(`/api/chips/${chipToDelete.value.id}`, { method: 'DELETE' })
    showDeleteModal.value = false
    chipToDelete.value = null
    await fetchChips()
  } catch (err: any) {
    deleteError.value = err?.statusMessage || err?.message || '删除失败'
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="min-h-full p-6">
    <!-- 页头 -->
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h2 class="text-xl font-bold text-ink">芯片列表</h2>
        <p class="mt-1 text-sm text-ink-tertiary">
          共 {{ chips?.length ?? 0 }} 条记录
        </p>
      </div>
      <div class="flex gap-2">
        <UButton
          icon="i-lucide-scan"
          color="data"
          variant="solid"
          size="sm"
          :loading="identifying"
          @click="identifyChip"
        >
          识别芯片
        </UButton>
        <UButton
          icon="i-lucide-sparkles"
          color="data"
          variant="outline"
          size="sm"
          :loading="vendorChecking"
          @click="checkVendors"
        >
          核查厂商
        </UButton>
        <UButton
          icon="i-lucide-printer"
          color="notice"
          variant="outline"
          size="sm"
          @click="openContainerPrint"
        >
          容器标签
        </UButton>
        <UButton
          to="/chips/new"
          icon="i-lucide-plus"
          color="primary"
          variant="solid"
          size="sm"
        >
          录入芯片
        </UButton>
        <a
          href="/api/export/database"
          download
          class="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-muted"
        >
          <UIcon name="i-lucide-download" class="h-3.5 w-3.5" />
          导出数据库
        </a>
      </div>
    </div>

    <!-- 搜索筛选栏 -->
    <div class="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-surface-raised p-4 ring-1 ring-line">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="搜索厂商 / 型号 / UID / JEDEC ID / 库位"
        class="flex-1 min-w-[240px]"
        size="sm"
      />
      <USelect
        :model-value="typeFilter ?? 'all'"
        :items="typeItems"
        size="sm"
        class="w-36"
        @update:model-value="onTypeChange"
      />
      <USelect
        :model-value="modelFilter ?? 'all'"
        :items="modelItems"
        size="sm"
        class="w-48"
        @update:model-value="onModelChange"
      />
      <UButton
        v-if="search || modelFilter || typeFilter"
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        size="sm"
        @click="search = ''; modelFilter = undefined; typeFilter = undefined"
      >
        清除
      </UButton>
    </div>

    <!-- 识别结果提示 -->
    <div
      v-if="identifyResult && identifyResult.matched && identifyResult.chip"
      class="mb-4 rounded-md bg-data-500/5 p-4 ring-1 ring-action/30"
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
      </div>
      <div class="mt-3 flex justify-end gap-2">
        <UButton color="neutral" variant="ghost" size="sm" @click="userDismissedIdentify = true; identifyResult = null">
          关闭
        </UButton>
        <UButton
          color="primary"
          variant="solid"
          size="sm"
          icon="i-lucide-external-link"
          :to="`/chips/${identifyResult.chip.id}`"
        >
          查看档案详情
        </UButton>
      </div>
    </div>

    <!-- 识别结果提示（未命中时显示） -->
    <div
      v-else-if="identifyResult && !identifyResult.matched"
      class="mb-4 rounded-md bg-notice-500/5 p-4 ring-1 ring-notice-500/30"
    >
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-package-plus" class="h-5 w-5 text-notice-400" />
        <span class="text-sm font-semibold text-notice-300">未识别到档案</span>
      </div>
      <p class="mt-2 text-sm text-ink-secondary">{{ identifyResult.reason }}</p>
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
      <div class="mt-3 flex justify-end gap-2">
        <UButton color="neutral" variant="ghost" size="sm" @click="userDismissedIdentify = true; identifyResult = null">
          关闭
        </UButton>
        <UButton color="primary" variant="solid" size="sm" to="/chips/new">
          去录入
        </UButton>
      </div>
    </div>

    <!-- 错误提示 -->
    <div
      v-if="fetchError"
      class="mb-4 flex items-center gap-3 rounded-lg bg-alert-500/10 p-4 ring-1 ring-alert-500/20"
    >
      <UIcon name="i-lucide-alert-circle" class="h-5 w-5 text-alert-400" />
      <span class="text-sm text-alert-300">加载失败: {{ fetchError?.message }}</span>
    </div>

    <!-- 数据表格 -->
    <div class="rounded-lg bg-surface-raised ring-1 ring-line">
      <div v-if="pending" class="p-8">
        <div class="animate-pulse space-y-3">
          <div v-for="i in 6" :key="i" class="h-10 rounded bg-surface-muted" />
        </div>
      </div>

      <div v-else-if="!chips?.length" class="px-5 py-16 text-center">
        <UIcon name="i-lucide-search-x" class="mx-auto h-10 w-10 text-ink-tertiary" />
        <p class="mt-3 text-sm text-ink-tertiary">
          {{ search || modelFilter || typeFilter ? '没有匹配的芯片' : '暂无芯片数据' }}
        </p>
        <UButton
          v-if="!search && !modelFilter && !typeFilter"
          to="/chips/new"
          icon="i-lucide-plus"
          color="primary"
          variant="outline"
          size="sm"
          class="mt-4"
        >
          录入第一颗芯片
        </UButton>
      </div>

      <div v-else class="p-2">
        <UTable
          :data="chips"
          :columns="columns"
          class="w-full"
          :ui="{ tr: 'cursor-pointer hover:bg-surface-muted transition-colors' }"
          @row-click="(row: any) => handleRowClick(row.original)"
        />
      </div>
    </div>

    <!-- 编辑芯片对话框 -->
    <UModal v-model:open="showEditModal" :title="`编辑芯片 - ${editForm.model ?? ''}`">
      <template #body>
        <div class="space-y-3">
          <div v-if="editError" class="rounded-md bg-alert-500/10 p-3 text-sm text-alert-300 ring-1 ring-alert-500/20">
            {{ editError }}
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-xs text-ink-tertiary">厂商</label>
              <UInputMenu v-model="editForm.vendor" :items="brandOptions" placeholder="选择品牌（可输入过滤）" class="w-full" />
            </div>
            <div>
              <label class="mb-1 block text-xs text-ink-tertiary">型号</label>
              <UInput v-model="editForm.model" class="w-full" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-xs text-ink-tertiary">类型</label>
              <USelect
                v-model="editForm.chip_type"
                :items="[
                  { label: 'NOR Flash', value: 'flash' },
                  { label: 'MCU 单片机', value: 'mcu' },
                  { label: '其他', value: 'other' }
                ]"
                class="w-full"
              />
            </div>
            <div v-if="editForm.chip_type !== 'other'">
              <label class="mb-1 block text-xs text-ink-tertiary">容量</label>
              <UInput v-model="editForm.capacity" placeholder="如: 16Mbit / 2MB" class="w-full" />
            </div>
            <div v-if="editForm.chip_type === 'other'">
              <label class="mb-1 block text-xs text-ink-tertiary">一级分类 *</label>
              <UInputMenu v-model="editRoot" :items="rootOptions" placeholder="选择一级分类（可输入过滤）" class="w-full" />
            </div>
            <div v-if="editForm.chip_type === 'other'">
              <label class="mb-1 block text-xs text-ink-tertiary">二级分类 *</label>
              <UInputMenu
                v-model="editForm.chip_category"
                :items="categoryOptions"
                :disabled="!editRoot"
                placeholder="选择二级分类（可输入过滤）"
                class="w-full"
              />
            </div>
            <div v-if="editForm.chip_type === 'other'">
              <label class="mb-1 block text-xs text-ink-tertiary">
                单包颗数
                <span v-if="String(editForm.uid ?? '').trim() && !isNoUid(String(editForm.uid))" class="text-ink-tertiary">（有 UID，锁定 1）</span>
              </label>
              <UInput
                v-model.number="editForm.qty_per_bag"
                type="number"
                min="1"
                step="1"
                :disabled="!!String(editForm.uid ?? '').trim() && !isNoUid(String(editForm.uid))"
                placeholder="1"
                class="w-full"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs text-ink-tertiary">封装</label>
              <UInputMenu v-model="editForm.package" :items="packageOptions" placeholder="选择封装（可输入过滤）" class="w-full" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div v-if="editForm.chip_type !== 'other'">
              <label class="mb-1 block text-xs text-ink-tertiary">JEDEC ID</label>
              <UInput v-model="editForm.jedec_id" class="w-full font-mono" />
            </div>
            <div>
              <label class="mb-1 block text-xs text-ink-tertiary">UID 长度 (字节)</label>
              <UInput v-model.number="editForm.uid_length" type="number" class="w-full" />
            </div>
          </div>

          <div>
            <label class="mb-1 block text-xs text-ink-tertiary">库位</label>
            <div class="grid grid-cols-3 gap-2">
              <UInput v-model="editForm.location_a" placeholder="大箱" class="w-full" />
              <UInput v-model="editForm.location_b" placeholder="小箱" class="w-full" />
              <UInput v-model="editForm.location_c" placeholder="序号" class="w-full" />
            </div>
          </div>

          <div>
            <label class="mb-1 block text-xs text-ink-tertiary">备注</label>
            <UTextarea v-model="editForm.note" :rows="3" class="w-full" />
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="editing" @click="showEditModal = false">
            取消
          </UButton>
          <UButton color="primary" variant="solid" :loading="editing" @click="confirmEdit">
            保存
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- 销毁确认对话框 -->
    <UModal v-model:open="showDeleteModal" :title="`销毁 ${chipToDelete?.model || '芯片'}？`">
      <template #body>
        <div class="space-y-3">
          <p class="text-sm text-ink-secondary">
            此操作将永久删除该芯片档案及其所有操作历史，且不可恢复。
          </p>
          <div v-if="chipToDelete" class="rounded-md bg-surface-muted p-3 font-mono text-xs text-ink-secondary">
            <div>型号：{{ chipToDelete.model }}</div>
            <div>类型：{{ chipTypeLabel(chipToDelete.chip_type) }}</div>
            <div>JEDEC ID：{{ formatJedecId(chipToDelete.jedec_id) || '-' }}</div>
            <div>UID：{{ truncateUid(chipToDelete.uid, 20) || '-' }}</div>
          </div>
          <div v-if="deleteError" class="rounded-md bg-alert-500/10 p-3 text-sm text-alert-300 ring-1 ring-alert-500/20">
            {{ deleteError }}
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :disabled="deleting" @click="showDeleteModal = false">
            取消
          </UButton>
          <UButton color="error" variant="solid" :loading="deleting" @click="confirmDelete">
            确认删除
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- 容器标签参数输入 -->
    <UModal v-model:open="showContainerParamModal" title="打印容器标签">
      <template #body>
        <div class="space-y-3">
          <div>
            <label class="mb-1 block text-xs text-ink-tertiary">容器类型</label>
            <USelect
              v-model="containerForm.kind"
              :items="[
                { label: '大箱（大容器）', value: 'big' },
                { label: '小箱（小容器）', value: 'small' }
              ]"
              class="w-full"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs text-ink-tertiary">名称</label>
            <UInput
              v-model="containerForm.name"
              :placeholder="containerForm.kind === 'big' ? '如: A / B / C' : '如: A-1 / B-2'"
              class="w-full"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs text-ink-tertiary">副标题（可选）</label>
            <UInput
              v-model="containerForm.subtitle"
              placeholder="如: 12 颗芯片"
              class="w-full"
            />
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="showContainerParamModal = false">
            取消
          </UButton>
          <UButton
            color="primary"
            variant="solid"
            :disabled="!containerForm.name.trim()"
            @click="confirmContainerParam"
          >
            预览
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- 容器标签打印（复用 PrintLabelModal） -->
    <PrintLabelModal
      v-model:open="showContainerPrintModal"
      mode="container"
      :container-kind="containerForm.kind"
      :container-name="containerForm.name.trim()"
      :container-subtitle="containerForm.subtitle.trim() || null"
    />

    <!-- 厂商核查结果 -->
    <UModal v-model:open="showVendorModal" title="厂商核查结果">
      <template #body>
        <div v-if="vendorCheckSummary" class="mb-4 grid grid-cols-4 gap-3">
          <div class="rounded-md bg-surface-muted p-3 ring-1 ring-line">
            <div class="text-xs text-ink-secondary">总数</div>
            <div class="mt-1 text-lg font-semibold text-ink">{{ vendorCheckSummary.total }}</div>
          </div>
          <div class="rounded-md bg-action/10 p-3 ring-1 ring-data-500/20">
            <div class="text-xs text-data-300">可自动填</div>
            <div class="mt-1 text-lg font-semibold text-data-200">{{ vendorCheckSummary.autoFillCount }}</div>
          </div>
          <div class="rounded-md bg-notice-500/10 p-3 ring-1 ring-notice-500/20">
            <div class="text-xs text-notice-300">冲突</div>
            <div class="mt-1 text-lg font-semibold text-notice-200">{{ vendorCheckSummary.conflictCount }}</div>
          </div>
          <div class="rounded-md bg-alert-500/10 p-3 ring-1 ring-alert-500/20">
            <div class="text-xs text-alert-300">未知</div>
            <div class="mt-1 text-lg font-semibold text-alert-200">{{ vendorCheckSummary.unknownCount }}</div>
          </div>
        </div>

        <div class="max-h-[400px] overflow-y-auto rounded-md bg-surface-sunken/30 ring-1 ring-line">
          <table class="w-full text-sm">
            <thead class="sticky top-0 bg-surface-raised/80 backdrop-blur">
              <tr class="border-b border-line text-left text-xs text-ink-secondary">
                <th class="px-3 py-2">型号</th>
                <th class="px-3 py-2">JEDEC</th>
                <th class="px-3 py-2">当前厂商</th>
                <th class="px-3 py-2">推荐厂商</th>
                <th class="px-3 py-2">状态</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in vendorCheckResults"
                :key="r.id"
                class="border-b border-line hover:bg-surface-muted"
              >
                <td class="px-3 py-2 text-ink">{{ r.model }}</td>
                <td class="px-3 py-2 font-mono text-xs text-ink-tertiary">{{ r.jedec_id || '-' }}</td>
                <td class="px-3 py-2">
                  <span :class="r.current_vendor ? 'text-ink' : 'text-ink-tertiary italic'">
                    {{ r.current_vendor || '(空)' }}
                  </span>
                </td>
                <td class="px-3 py-2">
                  <span :class="r.suggested_vendor ? 'text-data-300' : 'text-ink-tertiary italic'">
                    {{ r.suggested_vendor || '—' }}
                  </span>
                </td>
                <td class="px-3 py-2">
                  <component :is="vendorStatusBadge(r.status)" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-between items-center w-full">
          <div class="text-xs text-ink-tertiary">
            冲突条目不自动覆盖，未知的需要手动填
          </div>
          <div class="flex gap-2">
            <UButton color="neutral" variant="ghost" @click="showVendorModal = false">关闭</UButton>
            <UButton
              v-if="vendorCheckSummary && vendorCheckSummary.autoFillCount > 0"
              color="data"
              variant="solid"
              :loading="vendorChecking"
              @click="applyVendorAutoFill"
            >
              自动填 {{ vendorCheckSummary.autoFillCount }} 条空厂商
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
