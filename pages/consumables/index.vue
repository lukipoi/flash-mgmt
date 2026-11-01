<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { Consumable, ConsumableStatus } from '~~/shared/types'

definePageMeta({
  title: '耗材列表'
})

const UButton = resolveComponent('UButton')
const ULink = resolveComponent('ULink')

const STATUS_LABELS: Record<ConsumableStatus, string> = {
  in_use: '使用中',
  in_stock: '储备中'
}

const STATUS_STYLES: Record<ConsumableStatus, string> = {
  in_use: 'bg-notice-500/15 text-notice-400 ring-1 ring-notice-500/30',
  in_stock: 'bg-data-500/15 text-action ring-1 ring-action/30'
}

function statusBadge(status: ConsumableStatus) {
  return h('span', {
    class: [
      'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
      STATUS_STYLES[status]
    ]
  }, STATUS_LABELS[status] ?? status)
}

const search = ref('')
const statusFilter = ref<string | undefined>(undefined)
const consumables = ref<Consumable[]>([])
const pending = ref(false)
const fetchError = ref<any>(null)

// 行选择（批量打印）
const rowSelection = ref<Record<string, boolean>>({})
const selectedCount = computed(() => Object.values(rowSelection.value).filter(Boolean).length)
const selectedConsumables = computed(() =>
  consumables.value.filter(c => rowSelection.value[String(c.id)])
)
const showBatchPrintModal = ref(false)
function openBatchPrint() {
  if (!selectedConsumables.value.length) return
  showBatchPrintModal.value = true
}
function clearSelection() {
  rowSelection.value = {}
}

// 过期/临期置顶：已过期（按过期天数降序）→ 临期（按剩余天数升序）→ 其他
const sortedConsumables = computed(() => {
  const withWarn = consumables.value.map(c => ({
    c,
    warn: expiryWarning(calcExpiryDate(c.production_date, c.shelf_life, c.expiry_date))
  }))
  return withWarn.sort((a, b) => {
    const rank = (w: typeof a.warn) => (w?.level === 'expired' ? 0 : w?.level === 'soon' ? 1 : 2)
    const ra = rank(a.warn)
    const rb = rank(b.warn)
    if (ra !== rb) return ra - rb
    if (ra === 0) return b.warn!.days - a.warn!.days
    if (ra === 1) return a.warn!.days - b.warn!.days
    return 0
  }).map(x => x.c)
})

async function fetchConsumables() {
  pending.value = true
  fetchError.value = null
  try {
    const params: Record<string, string> = {}
    if (search.value) params.search = search.value
    if (statusFilter.value) params.status = statusFilter.value
    consumables.value = await $fetch<Consumable[]>('/api/consumables', { params })
  } catch (e: any) {
    fetchError.value = e
  } finally {
    pending.value = false
  }
}

onMounted(() => { fetchConsumables() })

const statusItems = [
  { label: '全部状态', value: 'all' },
  ...Object.entries(STATUS_LABELS).map(([v, l]) => ({ label: l, value: v }))
]

function onStatusChange(val: string | undefined) {
  statusFilter.value = (val === 'all' || !val) ? undefined : val
  fetchConsumables()
}

function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null
  return ((...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }) as T
}

const fetchDebounced = debounce(fetchConsumables, 300)
watch(search, () => { fetchDebounced() })

function formatLocation(a?: string | null, b?: string | null, c?: string | null): string {
  const parts = [a, b, c].filter(x => x && x.trim()).map(x => x!.trim())
  return parts.length ? parts.join('-') : '-'
}

const columns: TableColumn<Consumable>[] = [
  {
    id: 'select',
    header: ({ table }: any) => h('input', {
      type: 'checkbox',
      checked: table.getIsAllRowsSelected(),
      indeterminate: table.getIsSomeRowsSelected(),
      onChange: table.getToggleAllRowsSelectedHandler(),
      class: 'h-4 w-4 cursor-pointer accent-data-500'
    }),
    cell: ({ row }: any) => h('input', {
      type: 'checkbox',
      checked: row.getIsSelected(),
      onChange: row.getToggleSelectedHandler(),
      class: 'h-4 w-4 cursor-pointer accent-data-500'
    }),
    meta: { class: { th: 'w-10 text-center', td: 'w-10 text-center' } }
  },
  {
    accessorKey: 'brand',
    header: '品牌',
    cell: ({ row }) => h('span', { class: 'text-ink-secondary' }, row.getValue('brand') || '-')
  },
  {
    accessorKey: 'model',
    header: '型号',
    cell: ({ row }) => {
      const warn = expiryWarning(calcExpiryDate(row.original.production_date, row.original.shelf_life, row.original.expiry_date))
      return h('div', { class: 'flex items-center gap-2' }, [
        h(ULink, {
          to: `/consumables/${row.original.id}`,
          class: 'font-medium text-action hover:text-data-300'
        }, () => row.getValue('model')),
        warn
          ? h('span', {
              class: 'inline-flex animate-pulse items-center rounded-md bg-alert-500 px-1.5 py-0.5 text-xs font-bold text-on-button ring-1 ring-alert-400'
            }, warn.level === 'expired' ? `已过期${warn.days}天` : `${warn.days}天到期`)
          : null
      ])
    }
  },
  {
    accessorKey: 'serial_number',
    header: '序列号',
    cell: ({ row }) => h('span', { class: 'font-mono text-xs text-ink-secondary' }, row.getValue('serial_number') || '-')
  },
  {
    accessorKey: 'barcode',
    header: '商品条码',
    cell: ({ row }) => h('span', { class: 'font-mono text-xs text-notice-400' }, row.getValue('barcode') || '-')
  },
  {
    accessorKey: 'status',
    header: '状态',
    cell: ({ row }) => statusBadge(row.getValue('status'))
  },
  {
    accessorKey: 'location_a',
    header: '库位',
    cell: ({ row }) => h('span', { class: 'text-xs text-ink-secondary' },
      formatLocation(row.getValue('location_a'), row.getValue('location_b'), row.getValue('location_c')))
  },
  {
    accessorKey: 'note',
    header: '备注',
    cell: ({ row }) => h('span', { class: 'text-ink-tertiary' }, row.getValue('note') || '-')
  },
  {
    accessorKey: 'created_at',
    header: '录入时间',
    cell: ({ row }) => h('span', { class: 'text-xs text-ink-tertiary' }, formatDate(row.getValue('created_at')))
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

// ---- 编辑 ----
const showEditModal = ref(false)
const editing = ref(false)
const editError = ref<string | null>(null)
const editForm = reactive<Partial<Consumable>>({})
const editId = ref<number | null>(null)

// 库位自动序号（大箱+小箱填齐、序号为空时触发）
let editSeqPromise: Promise<void> | null = null
async function tryEditAutoSeq() {
  if (!editForm.location_a?.trim() || !editForm.location_b?.trim() || editForm.location_c?.trim()) return
  if (editSeqPromise) return
  editSeqPromise = (async () => {
    try {
      const rows: any[] = await $fetch('/api/consumables', {
        params: { location_a: editForm.location_a.trim(), location_b: editForm.location_b.trim() }
      })
      let maxN = 0
      for (const r of rows) {
        if (editId.value && r.id === editId.value) continue
        const n = parseInt(r.location_c, 10)
        if (!isNaN(n) && n > maxN) maxN = n
      }
      if (!editForm.location_c?.trim()) editForm.location_c = String(maxN + 1)
    } catch { /* 忽略 */ }
    editSeqPromise = null
  })()
}
watch(() => [editForm.location_a, editForm.location_b] as const, () => tryEditAutoSeq())

function openEditModal(c: Consumable) {
  editId.value = c.id
  Object.assign(editForm, c)
  editError.value = null
  showEditModal.value = true
}

async function confirmEdit() {
  if (!editId.value) return
  editing.value = true
  editError.value = null
  try {
    await $fetch(`/api/consumables/${editId.value}`, {
      method: 'PUT',
      body: editForm
    })
    showEditModal.value = false
    await fetchConsumables()
  } catch (err: any) {
    editError.value = err?.statusMessage || err?.message || '保存失败'
  } finally {
    editing.value = false
  }
}

// ---- 删除 ----
const showDeleteModal = ref(false)
const deleting = ref(false)
const deleteError = ref<string | null>(null)
const consumableToDelete = ref<Consumable | null>(null)

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

function openDeleteModal(c: Consumable) {
  consumableToDelete.value = c
  deleteError.value = null
  showDeleteModal.value = true
}

async function confirmDelete() {
  if (!consumableToDelete.value) return
  deleting.value = true
  deleteError.value = null
  try {
    await $fetch(`/api/consumables/${consumableToDelete.value.id}`, { method: 'DELETE' })
    showDeleteModal.value = false
    consumableToDelete.value = null
    await fetchConsumables()
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
        <h2 class="text-xl font-bold text-ink">耗材列表</h2>
        <p class="mt-1 text-sm text-ink-tertiary">共 {{ consumables?.length ?? 0 }} 条记录</p>
      </div>
      <div class="flex gap-2">
        <UButton
          v-if="selectedCount > 0"
          icon="i-lucide-printer"
          color="data"
          variant="solid"
          size="sm"
          @click="openBatchPrint"
        >
          批量打标 ({{ selectedCount }})
        </UButton>
        <UButton
          v-if="selectedCount > 0"
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="sm"
          @click="clearSelection"
        >
          取消选择
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
          to="/consumables/new"
          icon="i-lucide-plus"
          color="primary"
          variant="solid"
          size="sm"
        >
          录入耗材
        </UButton>
      </div>
    </div>

    <!-- 搜索筛选栏 -->
    <div class="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-surface-raised p-4 ring-1 ring-line">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="搜索品牌 / 型号 / SN / 条码 / 备注 / 库位"
        class="flex-1 min-w-[240px]"
        size="sm"
      />
      <USelect
        :model-value="statusFilter ?? 'all'"
        :items="statusItems"
        size="sm"
        class="w-32"
        @update:model-value="onStatusChange"
      />
      <UButton
        v-if="search || statusFilter"
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        size="sm"
        @click="search = ''; statusFilter = undefined"
      >
        清除
      </UButton>
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
          <div v-for="i in 5" :key="i" class="h-10 rounded bg-surface-muted" />
        </div>
      </div>

      <div v-else-if="!consumables?.length" class="px-5 py-16 text-center">
        <UIcon name="i-lucide-search-x" class="mx-auto h-10 w-10 text-ink-tertiary" />
        <p class="mt-3 text-sm text-ink-tertiary">
          {{ search || statusFilter ? '没有匹配的耗材' : '暂无耗材数据' }}
        </p>
        <UButton
          v-if="!search && !statusFilter"
          to="/consumables/new"
          icon="i-lucide-plus"
          color="primary"
          variant="outline"
          size="sm"
          class="mt-4"
        >
          录入第一个耗材
        </UButton>
      </div>

      <div v-else class="p-2">
        <UTable
          :data="sortedConsumables"
          :columns="columns"
          :row-selection-options="{ enableRowSelection: true }"
          :get-row-id="(row: Consumable) => String(row.id)"
          v-model:row-selection="rowSelection"
          class="w-full"
        />
      </div>
    </div>

    <!-- 编辑弹窗 -->
    <UModal v-model:open="showEditModal" :title="`编辑耗材 - ${editForm.model ?? ''}`">
      <template #body>
        <div class="space-y-4">
          <div v-if="editError" class="rounded-md bg-alert-500/10 p-3 text-sm text-alert-300 ring-1 ring-alert-500/20">
            {{ editError }}
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="mb-1.5 block text-sm font-medium text-ink-secondary">品牌</label>
              <UInput v-model="editForm.brand" class="w-full" />
            </div>
            <div>
              <label class="mb-1.5 block text-sm font-medium text-ink-secondary">型号</label>
              <UInput v-model="editForm.model" class="w-full" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="mb-1.5 block text-sm font-medium text-ink-secondary">序列号</label>
              <UInput v-model="editForm.serial_number" class="w-full font-mono" />
            </div>
            <div>
              <label class="mb-1.5 block text-sm font-medium text-ink-secondary">商品条码</label>
              <UInput v-model="editForm.barcode" class="w-full font-mono" />
            </div>
          </div>

          <div>
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">库位</label>
            <div class="grid grid-cols-3 gap-2">
              <UInput v-model="editForm.location_a" placeholder="大箱" class="w-full" />
              <UInput v-model="editForm.location_b" placeholder="小箱" class="w-full" />
              <UInput v-model="editForm.location_c" placeholder="序号" class="w-full" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="mb-1.5 block text-sm font-medium text-ink-secondary">状态</label>
              <USelect
                v-model="editForm.status"
                :items="Object.entries(STATUS_LABELS).map(([v, l]) => ({ label: l, value: v }))"
                class="w-full"
              />
            </div>
          </div>

          <div>
            <label class="mb-1.5 block text-sm font-medium text-ink-secondary">备注</label>
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

    <!-- 删除确认弹窗 -->
    <UModal v-model:open="showDeleteModal" :title="`删除 ${consumableToDelete?.model || '耗材'}？`">
      <template #body>
        <div class="space-y-3">
          <p class="text-sm text-ink-secondary">此操作不可恢复。</p>
          <div v-if="consumableToDelete" class="rounded-md bg-surface-muted p-3 font-mono text-xs text-ink-secondary">
            <div>品牌：{{ consumableToDelete.brand || '-' }}</div>
            <div>型号：{{ consumableToDelete.model }}</div>
            <div>序列号：{{ consumableToDelete.serial_number || '-' }}</div>
            <div>状态：{{ STATUS_LABELS[consumableToDelete.status] }}</div>
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
              placeholder="如: 12 颗耗材"
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

    <!-- 容器标签打印 -->
    <PrintLabelModal
      v-model:open="showContainerPrintModal"
      mode="container"
      :container-kind="containerForm.kind"
      :container-name="containerForm.name.trim()"
      :container-subtitle="containerForm.subtitle.trim() || null"
    />

    <!-- 批量耗材打印 -->
    <PrintLabelModal
      v-model:open="showBatchPrintModal"
      mode="consumable"
      :consumables="selectedConsumables"
    />
  </div>
</template>
