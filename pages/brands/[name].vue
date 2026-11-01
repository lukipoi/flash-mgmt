<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { Chip } from '~~/shared/types'

definePageMeta({
  title: '品牌详情'
})

const UBadge = resolveComponent('UBadge')

const route = useRoute()
const rawName = route.params.name as string

// 路由参数可能是任意写法（大小写混用/中文别名），统一归一成规范品牌名
const brandName = normalizeVendor(decodeURIComponent(rawName))
const brandMeta = findBrand(brandName)

interface BrandItem {
  name: string
  aliases: string
  logo: string | null
  builtin: boolean
  chip_count: number
}

// 品牌列表（含手动覆盖），用于编辑入口与别名展示
const { data: allBrands, refresh: refreshBrands } = await useFetch<BrandItem[]>('/api/brands')
const brandItem = computed(() => allBrands.value?.find(b => b.name === brandName) ?? null)

const showEditModal = ref(false)
const { reload: reloadLogoMap } = useBrandLogoMap()
function openEdit() {
  showEditModal.value = true
}
function onSaved(newName: string) {
  refreshBrands()
  refresh()
  reloadLogoMap()
  // 改名后跳转到新详情页
  if (newName !== brandName) {
    navigateTo(`/brands/${encodeURIComponent(newName)}`)
  }
}

const { data: chips, pending, error, refresh } = await useFetch<Chip[]>('/api/chips', {
  query: { vendor: brandName }
})

const flashCount = computed(() => chips.value?.filter(c => c.chip_type === 'flash').length ?? 0)
const mcuCount = computed(() => chips.value?.filter(c => c.chip_type === 'mcu').length ?? 0)

function formatLocation(a?: string | null, b?: string | null, c?: string | null): string {
  const parts = [a, b, c].filter(x => x && x.trim()).map(x => x!.trim())
  return parts.length ? parts.join('-') : '-'
}

const columns: TableColumn<Chip>[] = [
  {
    accessorKey: 'model',
    header: '型号',
    cell: ({ row }) => h('span', { class: 'font-medium text-ink' }, row.getValue('model') || '(未知)')
  },
  {
    accessorKey: 'chip_type',
    header: '类型',
    cell: ({ row }) => {
      const isMcu = row.getValue('chip_type') === 'mcu'
      return h(UBadge, {
        color: isMcu ? 'special' : 'data',
        variant: 'subtle',
        size: 'xs'
      }, () => isMcu ? 'MCU' : 'Flash')
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
      return h('span', { class: 'text-ink-secondary' }, type === 'mcu' ? '/' : (cap || '-'))
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
    cell: ({ row }) => h('div', { class: 'flex justify-end' }, [
      h('a', {
        href: `/chips/${row.original.id}`,
        class: 'text-xs text-action hover:text-data-300 hover:underline'
      }, '查看档案')
    ])
  }
]
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
        <div class="flex items-center gap-4">
          <BrandLogo :vendor="brandName" size="lg" />
          <div>
            <h2 class="text-xl font-bold text-ink">{{ brandName }}</h2>
            <p class="mt-1 text-sm text-ink-tertiary">
              共 {{ chips?.length ?? 0 }} 颗芯片 · Flash {{ flashCount }} / MCU {{ mcuCount }}
              <span v-if="!brandMeta?.logo && !brandItem?.logo" class="ml-2 text-ink-tertiary">(暂无该品牌 logo)</span>
            </p>
          </div>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <UButton
          icon="i-lucide-pencil"
          color="neutral"
          variant="outline"
          size="sm"
          @click="openEdit()"
        >
          编辑品牌
        </UButton>
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          size="sm"
          :loading="pending"
          @click="refresh()"
        >
          刷新
        </UButton>
      </div>
    </div>

    <!-- 错误提示 -->
    <div
      v-if="error"
      class="mb-4 flex items-center gap-3 rounded-lg bg-alert-500/10 p-4 ring-1 ring-alert-500/20"
    >
      <UIcon name="i-lucide-alert-circle" class="h-5 w-5 text-alert-400" />
      <span class="text-sm text-alert-300">加载失败: {{ error?.message }}</span>
    </div>

    <!-- 芯片列表 -->
    <div class="rounded-lg bg-surface-raised ring-1 ring-line">
      <div v-if="pending" class="p-8">
        <div class="animate-pulse space-y-3">
          <div v-for="i in 4" :key="i" class="h-10 rounded bg-surface-muted" />
        </div>
      </div>

      <div v-else-if="!chips?.length" class="px-5 py-16 text-center">
        <UIcon name="i-lucide-package-x" class="mx-auto h-10 w-10 text-ink-tertiary" />
        <p class="mt-3 text-sm text-ink-tertiary">该品牌下暂无芯片档案</p>
        <UButton to="/chips/new" icon="i-lucide-plus" color="primary" variant="outline" size="sm" class="mt-4">
          录入芯片
        </UButton>
      </div>

      <div v-else class="p-2">
        <UTable
          :data="chips"
          :columns="columns"
          class="w-full"
          :ui="{ tr: 'cursor-pointer hover:bg-surface-muted transition-colors' }"
        />
      </div>
    </div>

    <!-- 编辑品牌弹窗 -->
    <BrandAddModal
      v-if="brandItem"
      v-model:open="showEditModal"
      :edit-target="brandItem"
      @added="onSaved($event)"
    />
  </div>
</template>
