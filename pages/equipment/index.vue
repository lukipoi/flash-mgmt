<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { Equipment, EquipmentStatus } from '~~/shared/types'

definePageMeta({
  title: '设备列表'
})

const UButton = resolveComponent('UButton')
const ULink = resolveComponent('ULink')
const UBadge = resolveComponent('UBadge')

const STATUS_LABELS: Record<EquipmentStatus, string> = {
  normal: '正常',
  damaged: '损坏',
  lost: '丢失'
}

const STATUS_STYLES: Record<EquipmentStatus, string> = {
  normal: 'bg-green-500/15 text-green-400 ring-1 ring-green-500/30',
  damaged: 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30',
  lost: 'bg-red-500/15 text-red-400 ring-1 ring-red-500/30'
}

function statusBadge(status: EquipmentStatus) {
  return h('span', {
    class: [
      'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
      STATUS_STYLES[status]
    ]
  }, STATUS_LABELS[status] ?? status)
}

const search = ref('')
const statusFilter = ref<string | undefined>(undefined)
const equipments = ref<Equipment[]>([])
const pending = ref(false)
const fetchError = ref<any>(null)

async function fetchEquipment() {
  pending.value = true
  fetchError.value = null
  try {
    const params: Record<string, string> = {}
    if (search.value) params.search = search.value
    if (statusFilter.value) params.status = statusFilter.value
    equipments.value = await $fetch<Equipment[]>('/api/equipment', { params })
  } catch (e: any) {
    fetchError.value = e
  } finally {
    pending.value = false
  }
}

onMounted(() => { fetchEquipment() })

const statusItems = [
  { label: '全部状态', value: 'all' },
  ...Object.entries(STATUS_LABELS).map(([v, l]) => ({ label: l, value: v }))
]

function onStatusChange(val: string | undefined) {
  statusFilter.value = (val === 'all' || !val) ? undefined : val
  fetchEquipment()
}

function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null
  return ((...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }) as T
}

const fetchDebounced = debounce(fetchEquipment, 300)
watch(search, () => { fetchDebounced() })

const columns: TableColumn<Equipment>[] = [
  {
    accessorKey: 'brand',
    header: '品牌',
    cell: ({ row }) => h('span', { class: 'text-slate-400' }, row.getValue('brand') || '-')
  },
  {
    accessorKey: 'model',
    header: '型号',
    cell: ({ row }) => h(ULink, {
      to: `/equipment/${row.original.id}`,
      class: 'font-medium text-cyan-400 hover:text-cyan-300'
    }, () => row.getValue('model'))
  },
  {
    accessorKey: 'serial_number',
    header: '序列号',
    cell: ({ row }) => h('span', { class: 'font-mono text-xs text-slate-400' }, row.getValue('serial_number') || '-')
  },
  {
    accessorKey: 'status',
    header: '状态',
    cell: ({ row }) => statusBadge(row.getValue('status'))
  },
  {
    accessorKey: 'note',
    header: '备注',
    cell: ({ row }) => h('span', { class: 'text-slate-500' }, row.getValue('note') || '-')
  },
  {
    accessorKey: 'created_at',
    header: '录入时间',
    cell: ({ row }) => h('span', { class: 'text-xs text-slate-500' }, formatDate(row.getValue('created_at')))
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
const editForm = reactive<Partial<Equipment>>({})
const editId = ref<number | null>(null)

function openEditModal(eq: Equipment) {
  editId.value = eq.id
  Object.assign(editForm, eq)
  editError.value = null
  showEditModal.value = true
}

async function confirmEdit() {
  if (!editId.value) return
  editing.value = true
  editError.value = null
  try {
    await $fetch(`/api/equipment/${editId.value}`, {
      method: 'PUT',
      body: editForm
    })
    showEditModal.value = false
    await fetchEquipment()
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
const equipToDelete = ref<Equipment | null>(null)

function openDeleteModal(eq: Equipment) {
  equipToDelete.value = eq
  deleteError.value = null
  showDeleteModal.value = true
}

async function confirmDelete() {
  if (!equipToDelete.value) return
  deleting.value = true
  deleteError.value = null
  try {
    await $fetch(`/api/equipment/${equipToDelete.value.id}`, { method: 'DELETE' })
    showDeleteModal.value = false
    equipToDelete.value = null
    await fetchEquipment()
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
        <h2 class="text-xl font-bold text-slate-100">设备列表</h2>
        <p class="mt-1 text-sm text-slate-500">共 {{ equipments?.length ?? 0 }} 条记录</p>
      </div>
      <UButton
        to="/equipment/new"
        icon="i-lucide-plus"
        color="primary"
        variant="solid"
        size="sm"
      >
        录入设备
      </UButton>
    </div>

    <!-- 搜索筛选栏 -->
    <div class="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-[#1e1e3a] p-4 ring-1 ring-white/5">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="搜索品牌 / 型号 / 序列号 / 备注"
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
      class="mb-4 flex items-center gap-3 rounded-lg bg-red-500/10 p-4 ring-1 ring-red-500/20"
    >
      <UIcon name="i-lucide-alert-circle" class="h-5 w-5 text-red-400" />
      <span class="text-sm text-red-300">加载失败: {{ fetchError?.message }}</span>
    </div>

    <!-- 数据表格 -->
    <div class="rounded-lg bg-[#1e1e3a] ring-1 ring-white/5">
      <div v-if="pending" class="p-8">
        <div class="animate-pulse space-y-3">
          <div v-for="i in 5" :key="i" class="h-10 rounded bg-white/5" />
        </div>
      </div>

      <div v-else-if="!equipments?.length" class="px-5 py-16 text-center">
        <UIcon name="i-lucide-search-x" class="mx-auto h-10 w-10 text-slate-600" />
        <p class="mt-3 text-sm text-slate-500">
          {{ search || statusFilter ? '没有匹配的设备' : '暂无设备数据' }}
        </p>
        <UButton
          v-if="!search && !statusFilter"
          to="/equipment/new"
          icon="i-lucide-plus"
          color="primary"
          variant="outline"
          size="sm"
          class="mt-4"
        >
          录入第一台设备
        </UButton>
      </div>

      <div v-else class="p-2">
        <UTable :data="equipments" :columns="columns" class="w-full" />
      </div>
    </div>

    <!-- 编辑弹窗 -->
    <UModal v-model:open="showEditModal" :title="`编辑设备 - ${editForm.model ?? ''}`">
      <template #body>
        <div class="space-y-4">
          <div v-if="editError" class="rounded-md bg-red-500/10 p-3 text-sm text-red-300 ring-1 ring-red-500/20">
            {{ editError }}
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="mb-1.5 block text-sm font-medium text-slate-300">品牌</label>
              <UInput v-model="editForm.brand" class="w-full" />
            </div>
            <div>
              <label class="mb-1.5 block text-sm font-medium text-slate-300">型号</label>
              <UInput v-model="editForm.model" class="w-full" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="mb-1.5 block text-sm font-medium text-slate-300">序列号</label>
              <UInput v-model="editForm.serial_number" class="w-full font-mono" />
            </div>
            <div>
              <label class="mb-1.5 block text-sm font-medium text-slate-300">状态</label>
              <USelect
                v-model="editForm.status"
                :items="Object.entries(STATUS_LABELS).map(([v, l]) => ({ label: l, value: v }))"
                class="w-full"
              />
            </div>
          </div>

          <div>
            <label class="mb-1.5 block text-sm font-medium text-slate-300">备注</label>
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
    <UModal v-model:open="showDeleteModal" :title="`删除 ${equipToDelete?.model || '设备'}？`">
      <template #body>
        <div class="space-y-3">
          <p class="text-sm text-slate-300">此操作不可恢复。</p>
          <div v-if="equipToDelete" class="rounded-md bg-white/5 p-3 font-mono text-xs text-slate-400">
            <div>品牌：{{ equipToDelete.brand || '-' }}</div>
            <div>型号：{{ equipToDelete.model }}</div>
            <div>序列号：{{ equipToDelete.serial_number || '-' }}</div>
            <div>状态：{{ STATUS_LABELS[equipToDelete.status] }}</div>
          </div>
          <div v-if="deleteError" class="rounded-md bg-red-500/10 p-3 text-sm text-red-300 ring-1 ring-red-500/20">
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
  </div>
</template>
