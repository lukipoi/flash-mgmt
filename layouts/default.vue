<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'

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

// ---- 左侧导航「选中框」纵向平移（N1，2026-11-10 20:21 用户拍板：不用换色）----
// 只有 .nav-frame / .nav-bar 两层沿 Y 位移，12 个菜单项连同图标文字钉在原位。
// 布局是跨页常驻 DOM，框只建一次；用 route.path 而不是 click，前进/后退也要跟上。
// 样板：docs/side-nav-frame-motion-demo.html（N1–N4，N1 已落地）
const sideNav = ref<HTMLElement | null>(null)
const navFrame = ref<HTMLElement | null>(null)
const navBar = ref<HTMLElement | null>(null)
let navObserver: ResizeObserver | null = null

function placeNavFrame(instant = false) {
  const nav = sideNav.value
  if (!nav) return
  const item = nav.querySelector<HTMLElement>(`[data-to="${route.path}"]`)
  // 详情页等未精确匹配的路由：原本就没有菜单项高亮，框也不能悬空
  const hidden = !item
  for (const el of [navFrame.value, navBar.value]) {
    el?.classList.toggle('is-hidden', hidden)
  }
  if (!item) return
  const r = item.getBoundingClientRect()
  const n = nav.getBoundingClientRect()
  for (const el of [navFrame.value, navBar.value]) {
    if (!el) continue
    // 初始化 / 容器尺寸变化时瞬时落定，避免框「自己滑一下」
    if (instant) el.classList.add('no-trans')
    el.style.setProperty('--fy', `${r.top - n.top}px`)
    el.style.setProperty('--fh', `${r.height}px`)
  }
  if (instant) {
    void navFrame.value?.offsetWidth
    navFrame.value?.classList.remove('no-trans')
    navBar.value?.classList.remove('no-trans')
  }
}

watch(() => route.path, () => nextTick(() => placeNavFrame()))

onMounted(() => {
  nextTick(() => placeNavFrame(true))
  if (sideNav.value && typeof ResizeObserver !== 'undefined') {
    navObserver = new ResizeObserver(() => placeNavFrame(true))
    navObserver.observe(sideNav.value)
  }
})
onUnmounted(() => navObserver?.disconnect())

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
      <!-- N1：唯一一个「选中框」沿侧栏上下平移，左侧竖条跟着走。
           菜单项本体钉在原位；统一信号黄，不按菜单项 / 功能组换色。
           用 flex + gap 而不是 space-y，避免间距规则作用到绝对定位的框上。 -->
      <nav ref="sideNav" class="side-nav flex flex-1 flex-col gap-1 px-3 py-4">
        <NuxtLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          :data-to="item.to"
          active-class=""
          exact-active-class=""
          :aria-current="isActive(item.to) ? 'page' : undefined"
          class="nav-item relative flex shrink-0 items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors"
          :class="isActive(item.to)
            ? 'text-action'
            : 'text-ink-secondary hover:bg-surface-muted hover:text-ink'"
        >
          <span class="nav-item-lbl">
            <UIcon :name="item.icon" class="h-5 w-5 shrink-0" />
            {{ item.label }}
          </span>
        </NuxtLink>

        <button
          type="button"
          class="flex w-full shrink-0 items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink"
          @click="showScan = true"
        >
          <UIcon name="i-lucide-scan-line" class="h-5 w-5 shrink-0" />
          扫码查详情
        </button>

        <span ref="navFrame" class="nav-frame" aria-hidden="true"></span>
        <span ref="navBar" class="nav-bar" aria-hidden="true"></span>
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
