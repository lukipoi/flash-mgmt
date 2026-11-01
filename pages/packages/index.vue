<script setup lang="ts">
/**
 * 封装墙：内置封装 + 手动添加封装（含给内置补图）
 * 点击卡片进封装详情页；「新增封装」为封装图绑定通道（重名覆盖内置、可选别名与图上传）
 */
interface PackageItem {
  name: string
  aliases: string
  image: string | null
  builtin: boolean
  chip_count: number
}

const { data: packages, pending, error, refresh } = await useFetch<PackageItem[]>('/api/packages')

const showAddModal = ref(false)
function openAdd() {
  showAddModal.value = true
}

const search = ref('')
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return packages.value ?? []
  return (packages.value ?? []).filter(p =>
    p.name.toLowerCase().includes(q) || p.aliases.toLowerCase().includes(q)
  )
})
</script>

<template>
  <div class="min-h-full p-6">
    <!-- 页头 -->
    <div class="mb-6 flex items-center justify-between">
      <h2 class="text-xl font-bold text-ink">封装列表</h2>
      <div class="flex items-center gap-3">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="搜索封装 / 别名"
          class="w-56"
          size="sm"
        />
        <UButton
          icon="i-lucide-plus"
          color="primary"
          variant="solid"
          size="sm"
          @click="openAdd"
        >
          新增封装
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

    <!-- 封装卡片墙 -->
    <div v-if="pending" class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      <div v-for="i in 12" :key="i" class="h-28 animate-pulse rounded-lg bg-surface-muted" />
    </div>

    <div v-else-if="!filtered.length" class="px-5 py-16 text-center">
      <UIcon name="i-lucide-package-x" class="mx-auto h-10 w-10 text-ink-tertiary" />
      <p class="mt-3 text-sm text-ink-tertiary">{{ search ? '没有匹配的封装' : '暂无封装' }}</p>
    </div>

    <div v-else class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      <NuxtLink
        v-for="p in filtered"
        :key="p.name"
        :to="`/packages/${encodeURIComponent(p.name)}`"
        class="group flex flex-col items-center justify-between gap-2 rounded-lg bg-surface-raised p-4 ring-1 ring-line transition hover:bg-surface-muted hover:ring-action/30"
      >
        <div class="flex h-14 w-full items-center justify-center">
          <PackageImage :pkg="p.name" size="lg" />
        </div>
        <div class="w-full text-center">
          <p class="truncate text-sm font-medium text-ink group-hover:text-data-300" :title="p.name">
            {{ p.name }}
          </p>
          <p class="mt-0.5 text-xs text-ink-tertiary">
            {{ p.chip_count }} 颗芯片
          </p>
        </div>
      </NuxtLink>
    </div>

    <!-- 新增封装弹窗 -->
    <PackageAddModal v-model:open="showAddModal" @added="refresh()" />
  </div>
</template>
