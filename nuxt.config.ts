export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },
  // 监听所有网卡：手机通过局域网 IP 访问（http，配合 Chrome flag 标记安全源实现实时扫码）
  devServer: {
    host: '0.0.0.0',
    port: 3080
  },
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  ui: {
    // 关闭 @nuxt/ui 自带的 colorMode（@nuxtjs/color-mode），改由 composables/useTheme.ts
    // 统一管理 dark/light，避免两套系统抢同一个 .dark class 导致刷新后主题回退。
    colorMode: false,
    fonts: false  // 关掉 @nuxt/fonts，它会尝试连 fonts.google.com 拉元数据，国内网络超时拖慢启动
  },
  experimental: {
    appManifest: false
  },
  nitro: {
    externals: {
      external: ['node:sqlite']
    }
  },
  vite: {
    server: {
      hmr: {
        timeout: 60000
      },
      watch: {
        ignored: ['**/data/**', '**/.nuxt/**', '**/node_modules/**']
      }
    }
  },
  app: {
    head: {
      title: 'Chip Manager - 芯片库存管理系统',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' }
      ],
      // 防主题闪烁：首屏绘制前根据 localStorage('flash-theme') 先行设置 data-theme 与
      // .dark class，避免先闪默认暗色再切到用户已选的亮色。
      script: [
        {
          innerHTML:
            "(function(){try{var t=localStorage.getItem('flash-theme')||'dark';var e=document.documentElement;e.setAttribute('data-theme',t);e.classList.toggle('dark',t==='dark');}catch(_){}})();",
          tagPosition: 'head'
        }
      ]
    }
  }
})
