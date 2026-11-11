<script setup lang="ts">
/**
 * 危险操作警戒框 —— GUI 风格方案 A 案（红黑 6px / 0.8s 滚动警示条）
 *
 * 样式定义在 assets/css/endfield/utilities.css 的 .ef-hazard-* 全局母题类里，
 * 所有颜色取自 theme.css 的 --ef-danger / --ef-surface-raised / --ef-ink-secondary。
 *
 * 规范约束（docs/gui-style-guide.html 07 章「唯一例外」）：
 *   - 只用于危险操作区 / 不可撤销确认 / 设备运行中，每屏最多 1 处
 *   - 框内按钮仍只改背景色，禁止位移 / 缩放 / 旋转
 *   - prefers-reduced-motion 下警示条立即静止，保留静态斜纹
 *
 * 用法：<HazardAlert code="STC / ERASE"> ...说明文字... </HazardAlert>
 */
withDefaults(defineProps<{
  title?: string
  code?: string
}>(), {
  title: '危险操作 · 不可撤销',
  code: 'DANGER / IRREVERSIBLE'
})
</script>

<template>
  <div class="ef-hazard-frame" role="alert">
    <div class="ef-hazard-strip" aria-hidden="true" />
    <div class="ef-hazard-body">
      <div class="ef-hazard-title">
        {{ title }}
        <span v-if="code" class="ef-hazard-code">{{ code }}</span>
      </div>
      <div class="ef-hazard-content">
        <slot />
      </div>
    </div>
  </div>
</template>
