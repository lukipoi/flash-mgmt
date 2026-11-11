export default defineAppConfig({
  ui: {
    colors: {
      primary: 'action',
      secondary: 'neutral',
      neutral: 'neutral',
      success: 'success',
      info: 'info',
      warning: 'warning',
      error: 'danger',
      // Endfield 角色色（已扩展为完整色阶，见 assets/css/endfield/theme.css），
      // 让 @nuxt/ui 组件的 color 属性也能直接用 data/region/gain/notice/special/alert。
      data: 'data',
      region: 'region',
      gain: 'gain',
      notice: 'notice',
      special: 'special',
      alert: 'alert'
    },
    // 读取反馈 toast：按状态分流（2026-11-10 21:13 用户拍板「R4 只留给所有 ERR 和 WARN，别的走 R1」）
    //   error / warning          → R4 顶部 6px 静止斜纹警戒带 + 状态色描边
    //   success / info / neutral → R1 等宽状态码 + 深底等宽日志块
    // 这里只追加自定义类，视觉全部在 assets/css/endfield/utilities.css 的 .ef-toast 一套规则里。
    // Nuxt UI 的 UToast DOM 固定（leading / wrapper[title+description] / close / progress），
    // 没有独立的「抬头 / 日志块 / 排查行」槽，三段式由 CSS 伪元素 + description 日志块模拟，
    // 通道名仍由 title 承载 —— 因此 26 处 toast.add() 一行都不用改。
    //
    // ⚠️ 每个 slot 必须「保留 Nuxt UI 默认布局类 + 追加 ef-toast-*」，不能只写自定义类。
    //    app.config 的 slots 会「替换」而非「合并」theme.slots；只写自定义类会丢掉：
    //      root 的 relative/group/flex/gap-2.5、wrapper 的 w-0 flex-1 flex flex-col、
    //      progress 的 absolute inset-x-0 bottom-0、icon/close 的 shrink-0 / p-0。
    //    Toaster.vue 还会把 ui.base() 的 absolute inset-x-0 作为 class 传进 UToast，
    //    tailwind-merge 会用它盖掉 root 的 relative —— 这是 Toaster 堆叠定位的契约，
    //    utilities.css 里绝不能写 .ef-toast { position: relative } 把它改回去。
    //    曾因此让 ToastRoot 参与 viewport 的 fixed-height flex 流，被压到 56px 并裁掉描述。
    toast: {
      slots: {
        root: 'relative group overflow-hidden bg-default shadow-lg rounded-lg ring ring-default p-4 flex gap-2.5 focus:outline-none ef-toast',
        wrapper: 'w-0 flex-1 flex flex-col ef-toast-wrap',
        title: 'text-sm font-medium text-highlighted ef-toast-title',
        description: 'text-sm text-muted ef-toast-desc',
        icon: 'shrink-0 size-5 ef-toast-icon',
        close: 'p-0 ef-toast-close',
        progress: 'absolute inset-x-0 bottom-0 ef-toast-progress'
      },
      variants: {
        color: {
          error: { root: 'ef-toast--band ef-toast--err' },
          warning: { root: 'ef-toast--band ef-toast--warn' },
          success: { root: 'ef-toast--ok' },
          info: { root: 'ef-toast--info' },
          neutral: { root: 'ef-toast--neutral' },
          primary: { root: 'ef-toast--info' },
          secondary: { root: 'ef-toast--neutral' }
        }
      }
    }
  }
})
