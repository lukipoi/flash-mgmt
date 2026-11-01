<script setup lang="ts">
import { ref } from 'vue'

const route = useRoute()
// 扫码查详情弹窗（电脑摄像头 / 手机回传）
const showScan = ref(false)

const navItems = [
  { label: '仪表盘', to: '/', icon: 'i-lucide-layout-dashboard' },
  { label: '芯片列表', to: '/chips', icon: 'i-lucide-cpu' },
  { label: '录入芯片', to: '/chips/new', icon: 'i-lucide-plus-circle' },
  { label: '品牌列表', to: '/brands', icon: 'i-lucide-tags' },
  { label: '芯片类型', to: '/chip-types', icon: 'i-lucide-tag' },
  { label: '封装列表', to: '/packages', icon: 'i-lucide-box' },
  { label: '设备列表', to: '/equipment', icon: 'i-lucide-list' },
  { label: '录入设备', to: '/equipment/new', icon: 'i-lucide-zap' },
  { label: '耗材列表', to: '/consumables', icon: 'i-lucide-package' },
  { label: '录入耗材', to: '/consumables/new', icon: 'i-lucide-plus-square' },
  { label: '电路板列表', to: '/boards', icon: 'i-lucide-circuit-board' },
  { label: '录入电路板', to: '/boards/new', icon: 'i-lucide-square-plus' }
]

// 所有导航项只精确匹配自己的 path，避免父子路径互相高亮
function isActive(to: string): boolean {
  return route.path === to
}

// ---- 主题切换：统一走 composables/useTheme（单一主题来源）----
const { theme, toggleTheme } = useTheme()
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-surface text-ink">
    <!-- 左侧导航栏 -->
    <aside class="flex w-60 shrink-0 flex-col border-r border-line bg-surface-raised">
      <!-- Logo / 标题 -->
      <div class="border-b border-line px-5 py-5">
        <div class="flex items-center gap-3">
          <div
            class="relative flex h-10 w-10 items-center justify-center rounded-md bg-action/10 ring-1 ring-action/30 corner-brackets"
            style="--bracket-color: var(--ef-action)"
          >
            <UIcon name="i-lucide-cpu" class="h-6 w-6 text-action" />
          </div>
          <div>
            <h1 class="text-sm font-bold tracking-wide text-ink">Chip Manager</h1>
            <p class="text-xs text-ink-tertiary">芯片库存管理系统</p>
          </div>
        </div>
        <!-- Endfield 母题：测绘斜纹带 -->
        <div class="hatch mt-4 h-1.5 w-full opacity-60"></div>
      </div>

      <!-- 导航菜单 -->
      <nav class="flex-1 space-y-1 px-3 py-4">
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          active-class=""
          exact-active-class=""
          class="relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors"
          :class="isActive(item.to)
            ? 'bg-action/10 text-action ring-1 ring-action/20 before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:bg-action before:marker-bar'
            : 'text-ink-secondary hover:bg-surface-muted hover:text-ink'"
        >
          <UIcon :name="item.icon" class="h-5 w-5 shrink-0" />
          {{ item.label }}
        </NuxtLink>

        <button
          type="button"
          class="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink"
          @click="showScan = true"
        >
          <UIcon name="i-lucide-scan-line" class="h-5 w-5 shrink-0" />
          扫码查详情
        </button>
      </nav>

      <!-- 主题切换（演示多主题框架） -->
      <div class="border-t border-line px-3 py-3">
        <button
          type="button"
          class="flex w-full items-center justify-between rounded-md border border-line px-3 py-2 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink"
          @click="toggleTheme"
        >
          <span class="flex items-center gap-2">
            <UIcon :name="theme === 'dark' ? 'i-lucide-moon' : 'i-lucide-sun'" class="h-4 w-4" />
            主题
          </span>
          <span class="text-action">{{ theme === 'dark' ? '暗色' : '亮色' }}</span>
        </button>
      </div>
    </aside>

    <!-- 右侧主内容区 -->
    <main class="flex-1 overflow-y-auto">
      <slot />
    </main>

    <ScanToDetailModal v-model:open="showScan" />
  </div>
</template>
