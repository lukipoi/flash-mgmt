// 多主题框架：全局唯一的视觉主题来源（dark / light）。
//
// 设计：
//   - 直接驱动 Endfield 的 [data-theme] 与 Tailwind 的 .dark class（@nuxt/ui v3 组件
//     的明暗由 .dark class 决定，故只需管好这一个 class 即可）。
//   - 持久化到 localStorage('flash-theme')；nuxt.config 里的防闪烁 inline 脚本会在
//     首屏绘制前先行设置，避免主题闪烁。
//   - 已禁用 @nuxt/ui 自带的 colorMode（见 nuxt.config），避免两套系统抢同一个 class。
//
// 美术 agent 后续要加新主题：在这里扩展 ThemeName + 在
// assets/css/endfield/theme.css 增加对应的 [data-theme="xxx"] 变量即可，调用方无需改动。

export type ThemeName = 'dark' | 'light'

const STORAGE_KEY = 'flash-theme'

function apply(t: ThemeName) {
  if (import.meta.client) {
    const el = document.documentElement
    el.dataset.theme = t
    el.classList.toggle('dark', t === 'dark')
  }
}

export function useTheme() {
  // 必须在 setup 上下文内调用（Nuxt 要求 useState 等组合式在 plugin/hook/setup 中调用，
  // 不能在模块顶层调用）。同名 key 会自动在多次调用间共享状态。
  const theme = useState<ThemeName>('flash-theme', () => 'dark')

  function setTheme(t: ThemeName) {
    theme.value = t
    apply(t)
    if (import.meta.client) localStorage.setItem(STORAGE_KEY, t)
  }

  function toggleTheme() {
    setTheme(theme.value === 'dark' ? 'light' : 'dark')
  }

  // 客户端挂载后以 localStorage 为准对齐状态（防闪烁脚本已先行设置 DOM）
  onMounted(() => {
    const saved = (localStorage.getItem(STORAGE_KEY) as ThemeName | null) ?? 'dark'
    if (saved !== theme.value) theme.value = saved
    apply(theme.value)
  })

  return { theme, setTheme, toggleTheme }
}
