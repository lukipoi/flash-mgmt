/**
 * 全站共享的品牌 logo 映射（含手动品牌）
 * - BrandLogo 原本只查 utils/brands.ts 内置表，手动品牌 logo 永远无法显示
 * - 这里拉一次 GET /api/brands（内置+手动合并结果），按 规范名+别名 小写建索引
 * - useState 全局缓存，页面级只请求一次；多组件同时首次调用用 pending 防重
 * - 新增/编辑品牌后需调用 reload()，否则缓存里没有新品牌，logo 要刷新页面才出现
 */
interface BrandListItem {
  name: string
  aliases: string
  logo: string | null
  builtin: boolean
}

export function useBrandLogoMap() {
  const map = useState<Record<string, string | null> | null>('brand-logo-map', () => null)
  const fetching = useState<boolean>('brand-logo-map-fetching', () => false)

  async function load() {
    if (fetching.value) return
    fetching.value = true
    try {
      const list = await $fetch<BrandListItem[]>('/api/brands')
      const m: Record<string, string | null> = {}
      for (const b of list) {
        // 规范名 + 所有别名都指向同一 logo（归一化匹配用）
        m[b.name.toLowerCase()] = b.logo
        for (const a of (b.aliases || '').split(',')) {
          const k = a.trim().toLowerCase()
          if (k && !(k in m)) m[k] = b.logo
        }
      }
      map.value = m
    } catch {
      // 失败时保持 null，BrandLogo 退回内置表
    } finally {
      fetching.value = false
    }
  }

  if (import.meta.client && map.value === null && !fetching.value) load()

  /** 品牌新增/编辑后失效缓存并重新拉取，让新 logo 立即生效 */
  async function reload() {
    map.value = null
    fetching.value = false
    await load()
  }

  return { map, reload }
}
