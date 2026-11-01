<script setup lang="ts">
/**
 * 厂商 logo 组件
 * - 自动品牌名标准化（大小写/中英文别名 → 规范名）
 * - 用户提供的 logo 已全部抠出 alpha 透明通道，直接裸放不套衬底窗体
 * - 无 logo 的品牌显示首字母圆形徽章兜底
 * - 查找顺序：全站合并映射（含手动品牌/用户覆盖）→ 内置表（首屏即时显示兜底）
 * sm 用于表格/字段行内（h-4 图标），lg 用于详情页头图
 */
const props = withDefaults(defineProps<{
  vendor: string | null | undefined
  size?: 'sm' | 'lg'
}>(), {
  size: 'sm'
})

const brand = computed(() => findBrand(props.vendor))
const normalizedName = computed(() => normalizeVendor(props.vendor))
const { map: logoMap } = useBrandLogoMap()

const logo = computed(() => {
  const key = props.vendor?.trim().toLowerCase()
  // 合并映射优先（手动品牌、用户覆盖内置 logo 都在这里生效）；未加载完成时退回内置表
  if (key && logoMap.value && key in logoMap.value) {
    return logoMap.value[key] ?? brand.value?.logo ?? null
  }
  return brand.value?.logo ?? null
})

const imgClass = computed(() => props.size === 'lg'
  ? 'h-12 w-auto max-w-[160px] object-contain'
  : 'h-4 w-4 object-contain')
</script>

<template>
  <!-- 有 logo：透明底直接展示 -->
  <img v-if="logo" :src="logo" :alt="normalizedName" :class="imgClass" loading="lazy">
  <!-- 无 logo：首字母徽章兜底 -->
  <span
    v-else
    class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-surface-muted text-[10px] font-bold text-ink-secondary ring-1 ring-line"
    :title="normalizedName"
  >
    {{ normalizedName ? normalizedName[0].toUpperCase() : '?' }}
  </span>
</template>
