<script setup lang="ts">
/**
 * 品牌墙：内置品牌 + 手动添加品牌
 * 点击卡片进品牌详情页；「新增品牌」为 logo 绑定通道（名称防重、可选别名与 logo 上传）
 */
interface BrandItem {
  name: string
  aliases: string
  logo: string | null
  builtin: boolean
  chip_count: number
}

const { data: brands, pending, error, refresh } = await useFetch<BrandItem[]>('/api/brands')
const { reload: reloadLogoMap } = useBrandLogoMap()

// 新增/编辑后同时刷新列表和全站 logo 映射，否则新 logo 要整页刷新才出现
async function onBrandAdded() {
  await Promise.all([refresh(), reloadLogoMap()])
}

const showAddModal = ref(false)
const editTarget = ref<BrandItem | null>(null)

function openAdd() {
  editTarget.value = null
  showAddModal.value = true
}

function openEdit(b: BrandItem) {
  editTarget.value = b
  showAddModal.value = true
}

const search = ref('')
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return brands.value ?? []
  return (brands.value ?? []).filter(b =>
    b.name.toLowerCase().includes(q) || b.aliases.toLowerCase().includes(q)
  )
})
</script>

<template>
  <div class="min-h-full p-6">
    <!-- 页头 -->
    <div class="mb-6 flex items-center justify-between">
      <h2 class="text-xl font-bold text-ink">品牌列表</h2>
      <div class="flex items-center gap-3">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="搜索品牌 / 别名"
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
          新增品牌
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

    <!-- 品牌卡片墙 -->
    <div v-if="pending" class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      <div v-for="i in 12" :key="i" class="h-28 animate-pulse rounded-lg bg-surface-muted" />
    </div>

    <div v-else-if="!filtered.length" class="px-5 py-16 text-center">
      <UIcon name="i-lucide-package-x" class="mx-auto h-10 w-10 text-ink-tertiary" />
      <p class="mt-3 text-sm text-ink-tertiary">{{ search ? '没有匹配的品牌' : '暂无品牌' }}</p>
    </div>

    <div v-else class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      <div v-for="b in filtered" :key="b.name" class="group relative">
        <NuxtLink
          :to="`/brands/${encodeURIComponent(b.name)}`"
          class="flex flex-col items-center justify-between gap-2 rounded-lg bg-surface-raised p-4 ring-1 ring-line transition hover:bg-surface-muted hover:ring-action/30"
        >
          <div class="flex h-14 w-full items-center justify-center">
            <BrandLogo :vendor="b.name" size="lg" />
          </div>
          <div class="w-full text-center">
            <p class="truncate text-sm font-medium text-ink group-hover:text-data-300" :title="b.name">
              {{ b.name }}
            </p>
            <p class="mt-0.5 text-xs text-ink-tertiary">
              {{ b.chip_count }} 颗芯片
            </p>
          </div>
        </NuxtLink>
        <!-- 编辑按钮（右上角，阻止跳详情） -->
        <button
          type="button"
          class="absolute right-2 top-2 rounded p-1 text-ink-tertiary opacity-0 transition hover:bg-surface-muted hover:text-data-300 group-hover:opacity-100"
          title="编辑品牌"
          @click.prevent.stop="openEdit(b)"
        >
          <UIcon name="i-lucide-pencil" class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>

    <!-- 新增/编辑品牌弹窗 -->
    <BrandAddModal v-model:open="showAddModal" :edit-target="editTarget" @added="onBrandAdded" />
  </div>
</template>
