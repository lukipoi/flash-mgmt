<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { Stats } from '~~/shared/types'

definePageMeta({
  title: '仪表盘'
})

const { data: stats, pending, error, refresh } = await useFetch<Stats>('/api/stats', {
  default: () => ({ total: 0, models: [], by_type: { flash: 0, mcu: 0 } })
})

const maxModelCount = computed(() => {
  if (!stats.value?.models?.length) return 0
  return Math.max(...stats.value.models.map(m => m.count))
})

const columns: TableColumn<{ model: string; count: number; chip_type?: string }>[] = [
  {
    accessorKey: 'model',
    header: '型号',
    cell: ({ row }) => row.getValue('model') || '(未知)'
  },
  {
    accessorKey: 'chip_type',
    header: '类型',
    cell: ({ row }) => {
      const type = row.original.chip_type
      const isFlash = type === 'flash'
      return h(UBadge, {
        color: isFlash ? 'cyan' : 'purple',
        variant: 'subtle',
        size: 'xs'
      }, () => (isFlash ? 'NOR Flash' : 'MCU'))
    }
  },
  {
    accessorKey: 'count',
    header: '数量',
    cell: ({ row }) => {
      const count = row.getValue('count') as number
      return h('span', { class: 'font-mono font-semibold text-cyan-400' }, String(count))
    }
  }
]
</script>

<template>
  <div class="min-h-full p-6">
    <!-- 页头 -->
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h2 class="text-xl font-bold text-slate-100">仪表盘</h2>
        <p class="mt-1 text-sm text-slate-500">芯片库存概览</p>
      </div>
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

    <!-- 错误提示 -->
    <div
      v-if="error"
      class="mb-6 flex items-center gap-3 rounded-lg bg-red-500/10 p-4 ring-1 ring-red-500/20"
    >
      <UIcon name="i-lucide-alert-circle" class="h-5 w-5 text-red-400" />
      <span class="text-sm text-red-300">数据加载失败: {{ error.message }}</span>
    </div>

    <!-- 统计卡片 -->
    <div class="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        title="芯片总数"
        :value="stats?.total ?? 0"
        icon="i-lucide-cpu"
        color="cyan"
      />
      <StatCard
        title="NOR Flash"
        :value="stats?.by_type?.flash ?? 0"
        icon="i-lucide-hard-drive"
        color="cyan"
      />
      <StatCard
        title="MCU"
        :value="stats?.by_type?.mcu ?? 0"
        icon="i-lucide-microchip"
        color="purple"
      />
      <StatCard
        title="型号种类"
        :value="stats?.models?.length ?? 0"
        icon="i-lucide-layers"
        color="amber"
      />
    </div>

    <!-- 型号分布 -->
    <div class="rounded-lg bg-[#1e1e3a] ring-1 ring-white/5">
      <div class="flex items-center justify-between border-b border-white/5 px-5 py-4">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-bar-chart-3" class="h-5 w-5 text-cyan-400" />
          <h3 class="text-sm font-semibold text-slate-200">型号分布</h3>
        </div>
        <span class="text-xs text-slate-500">
          共 {{ stats?.models?.length ?? 0 }} 种型号
        </span>
      </div>

      <div v-if="pending" class="p-8">
        <div class="animate-pulse space-y-3">
          <div v-for="i in 5" :key="i" class="h-8 rounded bg-white/5" />
        </div>
      </div>

      <div v-else-if="!stats?.models?.length" class="px-5 py-12 text-center">
        <UIcon name="i-lucide-database" class="mx-auto h-10 w-10 text-slate-600" />
        <p class="mt-3 text-sm text-slate-500">暂无芯片数据</p>
        <UButton
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
        <UTable :data="stats.models" :columns="columns" class="w-full">
          <template #count-cell="{ row }">
            <div class="flex items-center gap-3">
              <span class="font-mono font-semibold text-cyan-400">
                {{ row.original.count }}
              </span>
              <div class="h-1.5 w-24 overflow-hidden rounded-full bg-white/5">
                <div
                  class="h-full rounded-full"
                  :class="row.original.chip_type === 'flash' ? 'bg-cyan-500/60' : 'bg-purple-500/60'"
                  :style="{ width: `${maxModelCount ? (row.original.count / maxModelCount) * 100 : 0}%` }"
                />
              </div>
            </div>
          </template>
        </UTable>
      </div>
    </div>
  </div>
</template>
