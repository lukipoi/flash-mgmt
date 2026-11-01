/**
 * 归一化 UID: 去空格、转大写，用于存储和匹配
 * "DE AD BE EF" → "DEADBEEF"
 * "deadbeef" → "DEADBEEF"
 */
export function normalizeUid(uid: string): string {
  if (!uid) return ''
  return uid.replace(/\s+/g, '').toUpperCase()
}

/**
 * 归一化 JEDEC ID: 去空格、转大写，用于存储和匹配
 * "85 60 14" → "856014"
 * "856014" → "856014"
 */
export function normalizeJedecId(jedecId: string): string {
  if (!jedecId) return ''
  return jedecId.replace(/\s+/g, '').toUpperCase()
}

/**
 * 格式化 UID 显示: 每 4 字节加空格分组
 * 输入 "DE AD BE EF 12 34 56 78" → "DEAD BEEF 1234 5678"
 * 输入 "DEADBEEF12345678" → "DEAD BEEF 1234 5678"
 */
export function formatUid(uid: string | null | undefined): string {
  if (!uid) return ''
  const hex = normalizeUid(uid)
  return hex.replace(/(.{4})/g, '$1 ').trim()
}

/**
 * 格式化 JEDEC ID 显示: 每字节加空格
 * "856014" → "85 60 14"
 */
export function formatJedecId(jedecId: string): string {
  if (!jedecId) return ''
  const hex = normalizeJedecId(jedecId)
  return hex.replace(/(.{2})/g, '$1 ').trim()
}

/**
 * 格式化日期时间显示
 * 输入 ISO 字符串 → "2025-01-15 14:30:25"
 */
export function formatDate(date: string): string {
  if (!date) return '-'
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return date
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * 截断长 UID 显示
 * "DEADBEEF12345678DEADBEEF12345678" (maxLen=16) → "DEADBEEF1234567…"
 */
export function truncateUid(uid: string | null | undefined, maxLen: number = 16): string {
  if (!uid) return ''
  const hex = normalizeUid(uid)
  if (hex.length <= maxLen) return hex
  return hex.slice(0, maxLen) + '…'
}

/**
 * 校验十六进制字符串合法性
 * 允许空格分隔，不允许除 [0-9a-fA-F] 和空格之外的字符
 */
export function isValidHex(hex: string): boolean {
  if (!hex) return false
  const clean = hex.replace(/\s+/g, '')
  if (!clean) return false
  return /^[0-9a-fA-F]+$/.test(clean)
}

/**
 * 无 UID 占位符：出厂不带 UID 的芯片（如旺宏 MX25 系列）填 "/"，表示忽略 UID
 */
export const NO_UID = '/'

export function isNoUid(uid: string | null | undefined): boolean {
  return !!uid && uid.trim() === NO_UID
}

/**
 * 校验 UID 合法性: 必须是合法十六进制，且长度匹配 uid_length；填 "/" 表示无 UID，直接通过
 */
export function isValidUid(uid: string, uidLength: number): { valid: boolean; error?: string } {
  if (!uid || !uid.trim()) return { valid: false, error: 'UID 为必填项（无 UID 可填 /）' }
  if (isNoUid(uid)) return { valid: true }
  if (!isValidHex(uid)) return { valid: false, error: 'UID 只能包含十六进制字符 (0-9, A-F)' }
  const clean = normalizeUid(uid)
  const expectedLen = uidLength * 2 // 每字节 2 个 hex 字符
  if (clean.length !== expectedLen) {
    return { valid: false, error: `UID 长度应为 ${uidLength} 字节 (${expectedLen} 个十六进制字符)，当前 ${clean.length} 个` }
  }
  return { valid: true }
}

/**
 * 校验 JEDEC ID 合法性: 必须是合法十六进制，通常为 3 字节 (6 字符)
 */
export function isValidJedecId(jedecId: string): { valid: boolean; error?: string } {
  if (!jedecId || !jedecId.trim()) return { valid: false, error: 'JEDEC ID 为必填项' }
  if (!isValidHex(jedecId)) return { valid: false, error: 'JEDEC ID 只能包含十六进制字符 (0-9, A-F)' }
  const clean = normalizeJedecId(jedecId)
  if (clean.length % 2 !== 0) return { valid: false, error: 'JEDEC ID 必须为偶数个字符 (每字节 2 个十六进制字符)' }
  if (clean.length < 2) return { valid: false, error: 'JEDEC ID 至少需要 1 字节' }
  return { valid: true }
}

/**
 * 根据 JEDEC ID 自动识别 Flash 容量
 * 标准 JEDEC SPI Flash ID: 厂商(1B) + 型号(1-2B) + 容量(1B) = 通常 3 字节 (6字符)
 * 容量代码范围: 0x10(64KB) ~ 0x28(256GB)
 * 超出范围或长度不符返回空串
 */
export function jedecIdToCapacity(jedecId: string): string {
  if (!jedecId) return ''
  const clean = normalizeJedecId(jedecId)
  // 必须正好 3 字节（6字符）才解析
  if (clean.length !== 6) return ''
  const capByte = clean.slice(4, 6)
  const capId = parseInt(capByte, 16)
  if (Number.isNaN(capId)) return ''
  // 合理性校验: 0x10(64KB) ~ 0x28(256GB)
  if (capId < 16 || capId > 40) return ''
  const bytes = Math.pow(2, capId)
  const mbit = bytes * 8 / (1024 * 1024)
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) {
    return `${Math.round(mbit)}Mbit / ${Math.round(mb)}MB`
  }
  const kb = bytes / 1024
  return `${Math.round(mbit * 1024)}Kbit / ${Math.round(kb)}KB`
}

/**
 * 完整 3 字节 JEDEC ID → 厂商名（最高优先级，精确匹配，唯一）
 * 按用户数据库真实样本 + 行业主流 SPI NOR Flash 整理
 * 注：JEDEC Manufacturer byte（首字节）不是全球唯一的，
 *     多家厂商可能共用同一首字节（如 Micron/XMC=0x20, ESMT/Puya=0x85），
 *     所以必须用完整 3 字节 ID 做主判断
 */
const JEDEC_FULL_ID_MAP: Record<string, string> = {
  // ===== Winbond (EFxx) =====
  'EF4014': 'Winbond',   // W25Q80 系列 8Mbit
  'EF4015': 'Winbond',   // W25Q16 系列 16Mbit
  'EF4017': 'Winbond',   // W25Q64 系列 64Mbit
  'EF4018': 'Winbond',   // W25Q128 系列 128Mbit
  'EF4019': 'Winbond',   // W25Q256 系列 256Mbit
  'EF6019': 'Winbond',   // W25Q256 低功耗/宽压版
  'EF401A': 'Winbond',   // W25Q512 512Mbit
  'EF401B': 'Winbond',   // W25Q01 1Gbit
  'EFAA21': 'Winbond',   // W25N01G SPI NAND 1Gbit
  'EFBA21': 'Winbond',   // W25M02G SPI NAND 2Gbit

  // ===== GigaDevice 兆易 (C8xx) =====
  'C82014': 'GigaDevice', // GD25L80
  'C84013': 'GigaDevice', // GD25Q40 4Mbit
  'C84014': 'GigaDevice', // GD25Q80
  'C84015': 'GigaDevice', // GD25Q16
  'C84016': 'GigaDevice', // GD25Q32
  'C84017': 'GigaDevice', // GD25Q64
  'C84018': 'GigaDevice', // GD25Q128
  'C84019': 'GigaDevice', // GD25Q256
  'C86014': 'GigaDevice', // GD25LQ80
  'C86016': 'GigaDevice', // GD25LQ32
  'C86017': 'GigaDevice', // GD25LQ64
  'C86018': 'GigaDevice', // GD25LQ128

  // ===== Macronix 旺宏 (C2xx) =====
  'C22014': 'Macronix',   // MX25L8006E
  'C22015': 'Macronix',   // MX25L1605
  'C22016': 'Macronix',   // MX25L3205
  'C22017': 'Macronix',   // MX25L6405
  'C22018': 'Macronix',   // MX25L12835
  'C22019': 'Macronix',   // MX25L25635
  'C24014': 'Macronix',   // MX25Q80
  'C24018': 'Macronix',   // MX25Q128

  // ===== BoyaMicro 博雅 (68xx) — 修正：实际首字节是 0x68 不是 0x52 =====
  '684014': 'BoyaMicro',  // BY25Q80
  '684015': 'BoyaMicro',  // BY25Q16
  '684016': 'BoyaMicro',  // BY25Q32
  '684017': 'BoyaMicro',  // BY25Q64
  '684018': 'BoyaMicro',  // BY25Q128
  '684019': 'BoyaMicro',  // BY25Q256
  '686014': 'BoyaMicro',  // BY25L80

  // ===== NANSI 南芯 (D5xx) — 修正：实际首字节是 0xD5 不是 0x53 =====
  'D53012': 'NANSI',      // N25Q04
  'D53013': 'NANSI',      // N25Q08
  'D53014': 'NANSI',      // N25S08
  'D53015': 'NANSI',      // N25S16 / N25Q16
  'D53016': 'NANSI',      // N25Q32
  'D53017': 'NANSI',      // N25Q64
  'D53018': 'NANSI',      // N25Q128

  // ===== Micron 美光 (20xx) =====
  '201011': 'Micron',     // M25P10
  '202010': 'Micron',     // M25P05 / N25Q05
  '202011': 'Micron',     // M25P10
  '202012': 'Micron',     // M25P20
  '202014': 'Micron',     // M25P80
  '202015': 'Micron',     // N25Q16
  '202017': 'Micron',     // N25Q64
  '202018': 'Micron',     // N25Q128
  '202019': 'Micron',     // N25Q256

  // ===== XMC 武汉新芯 (20xx) — 注意：和 Micron 共用 0x20！用完整 ID 区分 =====
  '204010': 'XMC',        // XM25Q04
  '204013': 'XMC',        // XM25Q08
  '204014': 'XMC',        // XM25Q12
  '204015': 'XMC',        // XM25QH16 / XM25Q16
  '204016': 'XMC',        // XM25Q32
  '204017': 'XMC',        // XM25Q64
  '204018': 'XMC',        // XM25QU128 / XM25Q128
  '204019': 'XMC',        // XM25Q256

  // ===== Puya 普冉 (85xx) — 注意：和 ESMT 共用 0x85！用完整 ID 区分 =====
  '856012': 'Puya',       // P25Q04
  '856013': 'Puya',       // P25Q08
  '856014': 'Puya',       // P25Q80
  '856015': 'Puya',       // P25Q16
  '856016': 'Puya',       // P25Q32
  '856017': 'Puya',       // P25Q64
  '856018': 'Puya',       // P25Q128
  '856019': 'Puya',       // P25Q256
  '852018': 'Puya',       // PY25F128

  // ===== ISSI (9Dxx) — 修正：首字节是 0x9D 不是 0x4B =====
  '9D6014': 'ISSI',       // IS25LP064 / IS25WP064
  '9D6015': 'ISSI',       // IS25LP128 系列低功耗
  '9D6017': 'ISSI',       // IS25LP256 系列
  '9D6018': 'ISSI',       // IS25LP128F / IS25WP128F
  '9D6019': 'ISSI',       // IS25LP256 / IS25WP256
  '9D601A': 'ISSI',       // IS25LP512

  // ===== Infineon (原 Spansion/Cypress) =====
  '010216': 'Infineon',   // S25FL127S
  '010217': 'Infineon',   // S25FL256S

  // ===== Microchip (原 SST) =====
  '1F2015': 'Microchip',  // SST25VF016
  '1F2016': 'Microchip',  // SST25VF032

  // ===== Zbit / 其他 =====
  'BA6015': 'Zbit',       // ZD25WQ16
  'BA6017': 'Zbit',       // ZB25VQ64 / ZD25WQ64
  '5E4017': 'Zbit',       // ZB25VQ64DSJG (可能是 Zbit 的另一批)

  // ===== 自定义 / 小厂 =====
  'D84014': '语创电子',    // YC25Q80
  '7F9D42': 'PMC',        // PM25LQ020B (PMC / 小厂)

  // ===== 无效 / 占位 =====
  'FFFFFFFFFF': '',
  '0000000000': '',
}

/**
 * JEDEC Manufacturer ID（首字节）→ 厂商名 —— 最低优先级兜底
 * 注意：多家厂商可能共用同一首字节（非唯一！）
 * 只在完整 ID 表和型号前缀都找不到时才用
 */
const JEDEC_MANUFACTURER_MAP: Record<string, string> = {
  'EF': 'Winbond',
  'C8': 'GigaDevice',
  'C2': 'Macronix',
  '68': 'BoyaMicro',
  'D5': 'NANSI',
  '20': '',          // Micron 和 XMC 共用，空串逼完整 ID 匹配
  '85': '',          // ESMT 和 Puya 共用，空串逼完整 ID 匹配
  '9D': 'ISSI',
  'BA': 'Zbit',
  '5E': 'Zbit',
  '52': 'BoyaMicro', // 少数 Boya 芯片
  '01': 'Infineon',
  '1F': 'Microchip',
  '28': 'STMicro',
  '37': 'AMIC',
  '4D': 'ESMT',
  '31': 'EON',
  '4B': 'ISSI',
  'AD': 'Microchip',
  '1C': 'Winbond',
  'A1': 'XINYI',
  '6B': 'Unknown',
  '0B': 'Unknown',
  'FF': '',
  '00': '',
}

/** 型号前缀 → 厂商 fallback（JEDEC ID 可能返回 FF/00 时使用） */
const MODEL_PREFIX_MAP: Array<{ prefix: RegExp; vendor: string }> = [
  { prefix: /^W2[45]/i, vendor: 'Winbond' },
  { prefix: /^W7[5-6]/i, vendor: 'Winbond' },
  { prefix: /^W3[5-9]N?|^W35/i, vendor: 'Winbond' },   // Winbond SPI NAND: W35N01GW
  { prefix: /^GD[258]|^GD5F|^GD5G|^GD5R|^GD5F/i, vendor: 'GigaDevice' },
  { prefix: /^MX[23]\d|^MX3[56]/i, vendor: 'Macronix' },
  { prefix: /^BY2[5-9]|^BY25/i, vendor: 'BoyaMicro' },
  { prefix: /^N25S|^N25Q|^N28Q/i, vendor: 'NANSI' },    // NANSI N25S16 / N25Q128
  { prefix: /^XM2[5-9]|^XM25/i, vendor: 'XMC' },        // XMC XM25Q16 等
  { prefix: /^P25[QD]|^PY25|^P25Q|^P25D/i, vendor: 'Puya' }, // Puya 普冉
  { prefix: /^MT2[5-9]|^MT25|^N25QD/i, vendor: 'Micron' },  // Micron（非 NANSI 的 N25 开头）
  { prefix: /^IS25L|^IS25W|^IS25Q/i, vendor: 'ISSI' },
  { prefix: /^M25[P/Q]/i, vendor: 'Micron' },
  { prefix: /^S2[59]\d|^CY[15]/i, vendor: 'Infineon' },
  { prefix: /^SST25/i, vendor: 'Microchip' },
  { prefix: /^AT25|^AT45/i, vendor: 'Microchip' },
  { prefix: /^EN25/i, vendor: 'EON' },
  { prefix: /^AMIC/i, vendor: 'AMIC' },
  { prefix: /^ESMT/i, vendor: 'ESMT' },
  { prefix: /^ZB25|^ZD25/i, vendor: 'Zbit' },
  { prefix: /^PM25/i, vendor: 'PMC' },
  { prefix: /^YC25/i, vendor: '语创电子' },
]

/**
 * JEDEC ID（优先）+ 型号前缀（fallback）→ 厂商名
 * 优先级：完整 3 字节 JEDEC 精确匹配 > 型号前缀匹配 > 首字节兜底
 * 空串表示无法识别
 */
export function jedecIdToVendor(jedecId: string, model?: string): string {
  const clean = normalizeJedecId(jedecId).toUpperCase()

  // 层级 1：完整 3 字节 JEDEC ID 精确匹配（唯一、可靠）
  if (clean.length >= 6) {
    const full3 = clean.slice(0, 6)
    const v = JEDEC_FULL_ID_MAP[full3]
    if (v !== undefined) return v
    // 也尝试前 6 字节（有些 JEDEC 读 4 字节，后两字节可能干扰）
  }
  if (clean.length >= 4) {
    const full4 = clean.slice(0, 4)
    // 也尝试 4 字节匹配（部分 Flash 读 JEDEC 会返回多字节）
    for (const [key, val] of Object.entries(JEDEC_FULL_ID_MAP)) {
      if (key.startsWith(full4)) return val
    }
  }

  // 层级 2：型号前缀 fallback（JEDEC 返回 FF/00 时的主力）
  if (model) {
    const m = model.trim().toUpperCase()
    for (const rule of MODEL_PREFIX_MAP) {
      if (rule.prefix.test(m)) return rule.vendor
    }
  }

  // 层级 3：首字节兜底（最低优先级，可能撞车）
  if (clean.length >= 2) {
    const mfrByte = clean.slice(0, 2)
    const v = JEDEC_MANUFACTURER_MAP[mfrByte]
    if (v) return v  // 空串表示此首字节和别人撞了，放弃
  }

  return ''
}

/**
 * 计算过期日期
 * 优先级：expiryDate（直接失效日期）> productionDate + shelfLife（时长）> shelfLife 本身是日期
 * @param productionDate 生产日期 "2026-10-17" / "2026-10" / "2026/10/17"
 * @param shelfLife      保质期 "24个月" / "24M" / "2年" / "2Y" / "2027-06"(直接到期)
 * @param expiryDate     失效日期 "2027-08-20"（产品直接印刷的过期日，最高优先级）
 * @returns "YYYY-MM-DD" 或 null
 */
export function calcExpiryDate(productionDate: string | null, shelfLife: string | null, expiryDate?: string | null): string | null {
  if (expiryDate && expiryDate.trim()) {
    const d = parseDateStr(expiryDate.trim())
    if (d) return formatDateOnly(d)
  }
  if (!productionDate || !shelfLife) return null

  const sl = shelfLife.trim()
  // 保质期本身就是日期 → 直接当过期日
  if (/^\d{4}[-/]\d{2}([-/]\d{2})?$/.test(sl)) {
    return normalizeDateStr(sl)
  }

  const prod = parseDateStr(productionDate.trim())
  if (!prod) return null

  const lower = sl.toLowerCase()
  // 月：24个月 / 24月 / 24M / 24m
  let m = lower.match(/^(\d+)\s*(?:个)?月$|^(\d+)\s*m$/)
  if (m) {
    const months = parseInt(m[1] || m[2] || '0', 10)
    prod.setMonth(prod.getMonth() + months)
    return formatDateOnly(prod)
  }
  // 年：2年 / 2Y / 2y
  m = lower.match(/^(\d+)\s*(?:年|y)$/)
  if (m) {
    const years = parseInt(m[1], 10)
    prod.setFullYear(prod.getFullYear() + years)
    return formatDateOnly(prod)
  }

  return null
}

function parseDateStr(s: string): Date | null {
  const m = s.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/)
  if (!m) return null
  const y = parseInt(m[1], 10)
  const mo = parseInt(m[2], 10) - 1
  const d = m[3] ? parseInt(m[3], 10) : 1
  const date = new Date(y, mo, d)
  return Number.isNaN(date.getTime()) ? null : date
}

function normalizeDateStr(s: string): string {
  const d = parseDateStr(s)
  return d ? formatDateOnly(d) : s
}

function formatDateOnly(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 过期警告判断
 * @param expiry 过期日期 "YYYY-MM-DD"（一般来自 calcExpiryDate）
 * @param soonDays 临期阈值（默认 30 天内算临期）
 * @returns expired=已过期 soon=临期；null=无需警告
 */
export function expiryWarning(expiry: string | null, soonDays = 30): { level: 'expired' | 'soon'; days: number } | null {
  if (!expiry) return null
  const exp = parseDateStr(expiry)
  if (!exp) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((exp.getTime() - today.getTime()) / 86400000)
  if (days < 0) return { level: 'expired', days: -days }
  if (days <= soonDays) return { level: 'soon', days }
  return null
}
