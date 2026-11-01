<script setup lang="ts">
/**
 * 封装示意图组件（与 BrandLogo 同构）
 * - 自动封装名标准化（大小写/空格/连字符混写 → 规范名）
 * - 封装图利用 alpha 透明底直接裸放，不套衬底窗体
 * - 无图封装用电路板图标兜底（首字母徽章对封装名区分度低，弃用）
 * sm 用于表格/字段行内（h-4 图标），lg 用于详情页头图
 */
const props = withDefaults(defineProps<{
  pkg: string | null | undefined
  size?: 'sm' | 'lg'
}>(), {
  size: 'sm'
})

const meta = computed(() => findPackage(props.pkg))
const normalizedName = computed(() => normalizePackage(props.pkg))
const image = computed(() => meta.value?.image ?? null)

const imgClass = computed(() => props.size === 'lg'
  ? 'h-12 w-auto max-w-[160px] object-contain'
  : 'h-4 w-4 object-contain')

const iconClass = computed(() => props.size === 'lg'
  ? 'h-10 w-10 text-ink-tertiary'
  : 'h-4 w-4 text-ink-tertiary')
</script>

<template>
  <!-- 有图：透明底直接展示 -->
  <img v-if="image" :src="image" :alt="normalizedName" :class="imgClass" loading="lazy">
  <!-- 无图：电路板图标兜底 -->
  <UIcon v-else name="i-lucide-circuit-board" :class="iconClass" :title="normalizedName || '未知封装'" />
</template>
