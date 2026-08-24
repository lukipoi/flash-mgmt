<script setup lang="ts">
const route = useRoute()

const navItems = [
  { label: '仪表盘', to: '/', icon: 'i-lucide-layout-dashboard' },
  { label: '芯片列表', to: '/chips', icon: 'i-lucide-cpu' },
  { label: '录入芯片', to: '/chips/new', icon: 'i-lucide-plus-circle' }
]

function isActive(to: string): boolean {
  if (to === '/') return route.path === '/'
  if (to === '/chips') return route.path === '/chips'
  return route.path.startsWith(to)
}

// CH341 连接状态
const ch341Status = ref<{ connected: boolean; reason?: string } | null>(null)
const checking = ref(false)

async function checkCh341() {
  checking.value = true
  try {
    const result = await $fetch<{ connected: boolean; reason?: string }>('/api/ch341-status', { method: 'POST' })
    ch341Status.value = result
  } catch {
    ch341Status.value = { connected: false, reason: '检测失败' }
  } finally {
    checking.value = false
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  // 暂时禁用 CH341 状态检测，确认是否是它导致的导航问题
  ch341Status.value = { connected: false, reason: '检测已禁用' }
  // setTimeout(() => {
  //   checkCh341()
  // }, 2000)
  // intervalId = setInterval(checkCh341, 60000)
})

onUnmounted(() => {
  if (intervalId) clearInterval(intervalId)
})
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
          class="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors"
          :class="isActive(item.to)
            ? 'bg-cyan-500/10 text-cyan-400 ring-1 ring-cyan-500/20'
            : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'"
        >
          <UIcon :name="item.icon" class="h-5 w-5 shrink-0" />
          {{ item.label }}
        </NuxtLink>
      </nav>

      <!-- 底部状态指示 -->
      <div class="border-t border-white/5 px-5 py-4">
        <div class="flex items-center gap-2">
          <span
            class="h-2 w-2 rounded-full transition-colors"
            :class="ch341Status === null
              ? 'bg-slate-500'
              : ch341Status.connected
                ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]'
                : 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]'"
          />
          <span
            class="text-xs"
            :class="ch341Status === null
              ? 'text-slate-500'
              : ch341Status.connected
                ? 'text-slate-400'
                : 'text-red-400'"
          >
            {{ ch341Status === null
              ? '检测中...'
              : ch341Status.connected
                ? 'CH341 已连接'
                : (ch341Status.reason || 'CH341 未连接') }}
          </span>
          <button
            class="ml-auto inline-flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:bg-white/5 hover:text-slate-300"
            :disabled="checking"
            @click="checkCh341"
          >
            <UIcon name="i-lucide-refresh-cw" class="h-3 w-3" :class="checking && 'animate-spin'" />
          </button>
        </div>
        <p class="mt-1 font-mono text-xs text-slate-600">CH341 SPI Bridge</p>
      </div>
    </aside>

    <!-- 右侧主内容区 -->
    <main class="flex-1 overflow-y-auto">
      <slot />
    </main>
  </div>
</template>
