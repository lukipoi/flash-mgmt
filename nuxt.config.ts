export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  ui: {
    colorMode: true
  },
  colorMode: {
    preference: 'dark',
    fallback: 'dark'
  },
  experimental: {
    appManifest: false
  },
  nitro: {
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
        // 忽略 data 目录，防止 SQLite WAL 文件变化触发 HMR 全页面刷新
        ignored: ['**/data/**', '**/.nuxt/**', '**/node_modules/**']
      }
    }
  },
  app: {
    head: {
      title: 'Flash 管理系统',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' }
      ]
    }
  }
})
