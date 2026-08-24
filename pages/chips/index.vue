<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { Chip, Stats } from '~~/shared/types'

definePageMeta({
  title: '芯片列表'
})

const UBadge = resolveComponent('UBadge')
const UButton = resolveComponent('UButton')

const search = ref('')
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
  { label: 'MCU 单片机', value: 'mcu' }
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
  const isMcu = type === 'mcu'
  return h(UBadge, {
    color: isMcu ? 'purple' : 'cyan',
    variant: 'subtle',
    size: 'xs'
  }, () => isMcu ? 'MCU' : 'Flash')
}

const columns: TableColumn<Chip>[] = [
  {
    accessorKey: 'model',
    header: '型号',
    cell: ({ row }) => h('span', { class: 'font-medium text-slate-200' }, row.getValue('model') || '(未知)')
  },
  {
    accessorKey: 'chip_type',
    header: '类型',
    cell: ({ row }) => chipTypeBadge(row.getValue('chip_type') || 'flash')
  },
  {
    accessorKey: 'uid',
    header: 'UID',
    cell: ({ row }) => h('span', {
      class: 'font-mono text-xs text-cyan-400',
      title: row.getValue('uid')
    }, truncateUid(row.getValue('uid') || '', 16))
  },
  {
    accessorKey: 'jedec_id',
    header: 'JEDEC ID',
    cell: ({ row }) => h('span', { class: 'font-mono text-xs text-slate-400' }, row.getValue('jedec_id') || '-')
  },
  {
    accessorKey: 'capacity',
    header: '容量',
    cell: ({ row }) => h('span', { class: 'text-slate-400' }, row.getValue('capacity') || '-')
  },
  {
    id: 'actions',
    header: '操作',
    meta: { class: { th: 'text-right', td: 'text-right' } },
    cell: ({ row }) => h('div', { class: 'flex justify-end gap-1' }, [
      h(UButton, {
        icon: 'i-lucide-eye',
        color: 'neutral',
        variant: 'ghost',
        size: 'xs',
        label: '查看',
        onClick: (e: Event) => { e.stopPropagation(); navigateTo(`/chips/${row.original.id}`) }
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

// ---- 删除芯片 ----
const showDeleteModal = ref(false)
const deleting = ref(false)
const deleteError = ref<string | null>(null)
const chipToDelete = ref<Chip | null>(null)

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
        <h2 class="text-xl font-bold text-slate-100">芯片列表</h2>
        <p class="mt-1 text-sm text-slate-500">
          共 {{ chips?.length ?? 0 }} 条记录
        </p>
      </div>
      <div class="flex gap-2">
        <UButton
          icon="i-lucide-scan"
          color="cyan"
          variant="solid"
          size="sm"
          :loading="identifying"
          @click="identifyChip"
        >
          识别芯片
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
          class="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1 text-xs font-medium text-slate-300 transition-colors hover:bg-white/5"
        >
          <UIcon name="i-lucide-download" class="h-3.5 w-3.5" />
          导出数据库
        </a>
      </div>
    </div>

    <!-- 搜索筛选栏 -->
    <div class="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-[#1e1e3a] p-4 ring-1 ring-white/5">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="搜索型号 / UID / JEDEC ID"
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
      class="mb-4 rounded-md bg-cyan-500/5 p-4 ring-1 ring-cyan-500/30"
    >
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-fingerprint" class="h-5 w-5 text-cyan-400" />
        <span class="text-sm font-semibold text-cyan-300">已识别档案</span>
        <UBadge color="info" variant="subtle" size="xs" class="font-mono">
          by {{ identifyResult.match_by }}
        </UBadge>
      </div>
      <div class="mt-3 space-y-1 rounded-md bg-white/5 p-3 font-mono text-xs text-slate-300">
        <div>型号：<span class="text-cyan-400">{{ identifyResult.chip.model }}</span></div>
        <div>类型：<span class="text-cyan-400">{{ identifyResult.chip.chip_type === 'mcu' ? 'MCU' : 'Flash' }}</span></div>
        <div>JEDEC ID：<span class="text-cyan-400">{{ identifyResult.chip.jedec_id }}</span></div>
        <div>容量：<span class="text-cyan-400">{{ identifyResult.chip.capacity || '-' }}</span></div>
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
      class="mb-4 rounded-md bg-amber-500/5 p-4 ring-1 ring-amber-500/30"
    >
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-package-plus" class="h-5 w-5 text-amber-400" />
        <span class="text-sm font-semibold text-amber-300">未识别到档案</span>
      </div>
      <p class="mt-2 text-sm text-slate-300">{{ identifyResult.reason }}</p>
      <div v-if="identifyResult.candidates?.length" class="mt-3 space-y-2">
        <p class="text-xs text-slate-500">同 JEDEC ID 的已存在芯片：</p>
        <div
          v-for="c in identifyResult.candidates"
          :key="c.id"
          class="flex items-center justify-between rounded-md bg-white/5 p-2 text-xs"
        >
          <div class="font-mono text-slate-300">
            <span class="text-slate-500">#{{ c.id }}</span>
            <span class="ml-2 text-cyan-400">{{ c.model }}</span>
            <span v-if="c.chip_type" class="ml-1" :class="c.chip_type === 'mcu' ? 'text-purple-400' : 'text-cyan-400'">[{{ c.chip_type === 'mcu' ? 'MCU' : 'Flash' }}]</span>
            <span class="ml-2 text-slate-500">UID: {{ truncateUid(c.uid, 12) }}</span>
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
      class="mb-4 flex items-center gap-3 rounded-lg bg-red-500/10 p-4 ring-1 ring-red-500/20"
    >
      <UIcon name="i-lucide-alert-circle" class="h-5 w-5 text-red-400" />
      <span class="text-sm text-red-300">加载失败: {{ fetchError?.message }}</span>
    </div>

    <!-- 数据表格 -->
    <div class="rounded-lg bg-[#1e1e3a] ring-1 ring-white/5">
      <div v-if="pending" class="p-8">
        <div class="animate-pulse space-y-3">
          <div v-for="i in 6" :key="i" class="h-10 rounded bg-white/5" />
        </div>
      </div>

      <div v-else-if="!chips?.length" class="px-5 py-16 text-center">
        <UIcon name="i-lucide-search-x" class="mx-auto h-10 w-10 text-slate-600" />
        <p class="mt-3 text-sm text-slate-500">
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
          :ui="{ tr: 'cursor-pointer hover:bg-white/5 transition-colors' }"
          @row-click="(row: any) => handleRowClick(row.original)"
        />
      </div>
    </div>

    <!-- 销毁确认对话框 -->
    <UModal v-model:open="showDeleteModal" :title="`销毁 ${chipToDelete?.model || '芯片'}？`">
      <template #body>
        <div class="space-y-3">
          <p class="text-sm text-slate-300">
            此操作将永久删除该芯片档案及其所有操作历史，且不可恢复。
          </p>
          <div v-if="chipToDelete" class="rounded-md bg-white/5 p-3 font-mono text-xs text-slate-400">
            <div>型号：{{ chipToDelete.model }}</div>
            <div>类型：{{ chipToDelete.chip_type === 'mcu' ? 'MCU' : 'Flash' }}</div>
            <div>JEDEC ID：{{ chipToDelete.jedec_id }}</div>
            <div>UID：{{ truncateUid(chipToDelete.uid, 20) }}</div>
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
