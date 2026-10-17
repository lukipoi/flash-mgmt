<script setup lang="ts">
const route = useRoute()

const navItems = [
  { label: '仪表盘', to: '/', icon: 'i-lucide-layout-dashboard' },
  { label: '芯片列表', to: '/chips', icon: 'i-lucide-cpu' },
  { label: '录入芯片', to: '/chips/new', icon: 'i-lucide-plus-circle' },
  { label: '设备列表', to: '/equipment', icon: 'i-lucide-list' },
  { label: '录入设备', to: '/equipment/new', icon: 'i-lucide-zap' },
  { label: '耗材列表', to: '/consumables', icon: 'i-lucide-package' },
  { label: '录入耗材', to: '/consumables/new', icon: 'i-lucide-plus-square' },
  { label: '电路板列表', to: '/boards', icon: 'i-lucide-circuit-board' },
  { label: '录入电路板', to: '/boards/new', icon: 'i-lucide-square-plus' }
]

// 所有导航项只精确匹配自己的 path，避免父子路径互相高亮
// 详情页 /chips/:id 时「芯片列表」不会额外亮，保持纯粹
function isActive(to: string): boolean {
  return route.path === to
}
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-[#1a1a2e] text-slate-200">
    <!-- 左侧导航栏 -->
    <aside class="flex w-60 shrink-0 flex-col border-r border-white/5 bg-[#16213e]">
      <!-- Logo / 标题 -->
      <div class="flex items-center gap-3 border-b border-white/5 px-5 py-5">
        <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/10 ring-1 ring-cyan-500/30">
          <UIcon name="i-lucide-cpu" class="h-6 w-6 text-cyan-400" />
        </div>
        <div>
          <h1 class="text-sm font-bold tracking-wide text-slate-100">Chip Manager</h1>
          <p class="text-xs text-slate-500">芯片库存管理系统</p>
        </div>
      </div>

      <!-- 导航菜单 -->
      <nav class="flex-1 space-y-1 px-3 py-4">
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          active-class=""
          exact-active-class=""
          class="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors"
          :class="isActive(item.to)
            ? 'bg-cyan-500/10 text-cyan-400 ring-1 ring-cyan-500/20'
            : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'"
        >
          <UIcon :name="item.icon" class="h-5 w-5 shrink-0" />
          {{ item.label }}
        </NuxtLink>
      </nav>
    </aside>

    <!-- 右侧主内容区 -->
    <main class="flex-1 overflow-y-auto">
      <slot />
    </main>
  </div>
</template>
