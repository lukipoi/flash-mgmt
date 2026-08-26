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
export function formatUid(uid: string): string {
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
export function truncateUid(uid: string, maxLen: number = 16): string {
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
 * 校验 UID 合法性: 必须是合法十六进制，且长度匹配 uid_length
 */
export function isValidUid(uid: string, uidLength: number): { valid: boolean; error?: string } {
  if (!uid || !uid.trim()) return { valid: false, error: 'UID 为必填项' }
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
 * 根据 JEDEC ID 第三字节自动识别容量
 * 标准公式: 容量(字节) = 2^capacity_id
 * 返回如 "16Mbit / 2MB" 的字符串，无法识别时返回空串
 * 支持两种格式: "85 60 14" 或 "856014"
 */
export function jedecIdToCapacity(jedecId: string): string {
  if (!jedecId) return ''
  const clean = normalizeJedecId(jedecId)
  // 从无空格格式中提取第三字节
  const capByte = clean.length >= 6 ? clean.slice(4, 6) : (clean.length === 2 ? clean : '')
  if (!capByte) return ''
  const capId = parseInt(capByte, 16)
  if (Number.isNaN(capId)) return ''
  const bytes = Math.pow(2, capId)
  const mbit = bytes * 8 / (1024 * 1024)
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) {
    return `${Math.round(mbit)}Mbit / ${Math.round(mb)}MB`
  }
  const kb = bytes / 1024
  return `${Math.round(mbit * 1024)}Kbit / ${Math.round(kb)}KB`
}
