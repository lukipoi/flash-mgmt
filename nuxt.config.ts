export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  ui: {
    colorMode: true,
    fonts: false  // 关掉 @nuxt/fonts，它会尝试连 fonts.google.com 拉元数据，国内网络超时拖慢启动
  },
  colorMode: {
    preference: 'dark',
    fallback: 'dark'
  },
  experimental: {
    appManifest: false
  },
  nitro: {
    nodeCompatibility: true,
    externals: {
      external: ['node:sqlite']
    },
    devServer: {
      port: 3080
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
      ]
    }
  }
})
