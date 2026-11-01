/**
 * 品牌名标准化 + 厂商 logo 映射
 * - normalizeVendor: 大小写混用 / 中英文别名 → 统一规范名（如 "winbond"/"华邦电子" → "Winbond"）
 * - vendorLogoUrl:   规范名 → /vendors/ 下 logo 路径
 * logo 文件由用户提供的抠底 PNG/SVG 复制而来，深色透明图形统一用 BrandLogo 组件加浅色衬底展示
 */

export interface BrandMeta {
  /** 规范品牌名（数据库存储/显示统一用它） */
  name: string
  /** logo 路径（public/ 下相对路径），无 logo 不设置 */
  logo?: string
  /** 别名（匹配时统一转小写比较），规范名本身自动加入 */
  aliases: string[]
}

export const BRANDS: BrandMeta[] = [
  // ===== Flash 存储类 =====
  { name: 'Winbond',    logo: '/vendors/winbond.png',    aliases: ['华邦', '华邦电子'] },
  { name: 'GigaDevice', logo: '/vendors/gigadevice.png', aliases: ['gd', '兆易', '兆易创新'] },
  { name: 'Macronix',   logo: '/vendors/macronix.png',   aliases: ['mx', '旺宏', '旺宏电子'] },
  { name: 'BoyaMicro',  logo: '/vendors/boyamicro.png',  aliases: ['boya', '博雅', '博雅微', '博雅微电子'] },
  { name: 'NANSI',      aliases: ['南芯'] },
  { name: 'Micron',     logo: '/vendors/micron.svg',     aliases: ['美光', '美光科技'] },
  { name: 'XMC',        logo: '/vendors/xmc.png',        aliases: ['武汉新芯', '新芯'] },
  { name: 'Puya',       logo: '/vendors/puya.png',       aliases: ['普冉', '普冉半导体'] },
  { name: 'ISSI',       logo: '/vendors/issi.png',       aliases: ['矽成', '北京矽成'] },
  { name: 'Infineon',   aliases: ['英飞凌', 'cypress', '赛普拉斯', 'spansion'] },
  { name: 'Microchip',  logo: '/vendors/microchip.png',  aliases: ['微芯', '微芯科技', 'sst'] },
  { name: 'Zbit',       logo: '/vendors/zbit.png',       aliases: ['智炳'] },
  { name: 'PMC',        aliases: [] },
  { name: 'ESMT',       aliases: [] },
  { name: 'EON',        aliases: ['宜扬'] },
  { name: 'AMIC',       aliases: [] },
  { name: 'XINYI',      aliases: [] },
  { name: '语创电子',    aliases: [] },

  // ===== MCU / 模拟类 =====
  { name: 'STMicro',    logo: '/vendors/st.svg',         aliases: ['st', 'stmicroelectronics', '意法', '意法半导体'] },
  { name: 'TI',         logo: '/vendors/ti.svg',         aliases: ['texas instruments', 'texasinstrument', '德州仪器'] },
  { name: 'NXP',        logo: '/vendors/nxp.svg',        aliases: ['freescale', '飞思卡尔', '恩智浦', '恩智浦半导体'] },
  { name: 'onsemi',     logo: '/vendors/onsemi.svg',     aliases: ['on semiconductor', '安森美', '安森美半导体'] },
  { name: 'Espressif',  logo: '/vendors/espressif.svg',  aliases: ['esp32', 'esp8266', '乐鑫', '乐鑫科技'] },
  { name: 'Artery',     logo: '/vendors/artery.png',     aliases: ['at32', '雅特力', '雅特力科技'] },
  { name: 'WCH',        logo: '/vendors/wch.png',        aliases: ['沁恒', '沁恒微', '沁恒微电子', '南京沁恒'] },
  { name: 'STC',        logo: '/vendors/stc.png',        aliases: ['stcmcu', '宏晶'] },
  { name: 'Nations',    logo: '/vendors/nations.png',    aliases: ['国民技术', 'NSING', 'Nationz'] },
  { name: 'Chipsea',    logo: '/vendors/chipsea.png',    aliases: ['芯海', '芯海科技'] },
  { name: 'XHSC',       logo: '/vendors/xhsc.png',       aliases: ['小华', '小华半导体'] },
  { name: 'Gainsil',    logo: '/vendors/gainsil.png',    aliases: ['聚洵', '聚洵半导体'] },
  { name: 'Silergy',    logo: '/vendors/silergy.png',    aliases: ['矽力杰', '矽力杰半导体'] },
  { name: 'Chipanalog', logo: '/vendors/chipanalog.png', aliases: ['川土微', '川土微电子'] },
  { name: 'Injoinic',   logo: '/vendors/injoinic.png',   aliases: ['英集芯', '英集芯科技'] },
  { name: 'Topower',    logo: '/vendors/toppower.png',   aliases: [] },
  { name: 'Diodes',     logo: '/vendors/diodes.svg',     aliases: ['diodes incorporated', '达尔'] },
  { name: 'JMX',        logo: '/vendors/jmx.png',        aliases: ['捷茂微', '捷茂微电子'] },
  { name: 'Titanmec',   logo: '/vendors/titanmec.png',   aliases: ['天微', '天微电子', '深圳天微', 'Tianwei'] },
  { name: 'COSINE',     logo: '/vendors/cosine.png',     aliases: ['科山芯创', 'keshan'] },
]

/** 小写 key → 规范名 查找表（模块加载时构建一次） */
const VENDOR_BY_KEY: Record<string, string> = (() => {
  const map: Record<string, string> = {}
  for (const b of BRANDS) {
    map[b.name.toLowerCase()] = b.name
    for (const a of b.aliases) {
      const k = a.trim().toLowerCase()
      // 别名冲突时保留先注册的（表内顺序即优先级）
      if (!(k in map)) map[k] = b.name
    }
  }
  return map
})()

const BRAND_BY_NAME: Record<string, BrandMeta> = Object.fromEntries(
  BRANDS.map(b => [b.name, b])
)

/**
 * 品牌名标准化
 * "winbond" / "WINBOND" / "华邦电子" → "Winbond"
 * 未知品牌返回 trim 后的原文（不强改，避免误伤自定义厂商）
 */
export function normalizeVendor(vendor: string | null | undefined): string {
  if (!vendor) return ''
  const trimmed = vendor.trim()
  if (!trimmed) return ''
  return VENDOR_BY_KEY[trimmed.toLowerCase()] ?? trimmed
}

/** 规范名 → BrandMeta（未收录返回 null） */
export function findBrand(vendor: string | null | undefined): BrandMeta | null {
  const name = normalizeVendor(vendor)
  return name ? BRAND_BY_NAME[name] ?? null : null
}

/** 品牌名 → logo URL（无 logo 返回 null） */
export function vendorLogoUrl(vendor: string | null | undefined): string | null {
  return findBrand(vendor)?.logo ?? null
}
