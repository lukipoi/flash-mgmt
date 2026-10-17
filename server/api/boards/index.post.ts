import { db } from '../../database/init'
import type { CircuitBoardStatus } from '~~/shared/types'

const VALID_STATUSES: CircuitBoardStatus[] = ['pending', 'partial', 'done']

// 规范化 chips：接受 string[]（前端传来的），序列化为 JSON 字符串
function serializeChips(chips: any): string | null {
  if (!chips) return null
  if (Array.isArray(chips)) {
    const cleaned = chips
      .map((c: any) => String(c).trim())
      .filter((c: string) => c.length > 0)
    if (cleaned.length === 0) return null
    return JSON.stringify(cleaned)
  }
  // 也接受逗号分隔字符串（兜底）
  if (typeof chips === 'string') {
    const parts = chips.split(/[,，]/).map(s => s.trim()).filter(Boolean)
    if (parts.length === 0) return null
    return JSON.stringify(parts)
  }
  return null
}

function parseBoardRow(row: any) {
  if (!row) return row
  let chips: string[] | null = null
  if (row.chips) {
    try {
      const parsed = JSON.parse(row.chips)
      chips = Array.isArray(parsed) ? parsed : null
    } catch { /* ignore */ }
  }
  const { chips: _, ...rest } = row
  return { ...rest, chips }
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { brand, model, serial_number, status, chips, note } = body

  if (!model || !String(model).trim()) {
    throw createError({ statusCode: 400, statusMessage: '缺少必填字段: model' })
  }

  const st = VALID_STATUSES.includes(status) ? status : 'pending'
  const chipsJson = serializeChips(chips)

  const stmt = db.prepare(`
    INSERT INTO circuit_boards (brand, model, serial_number, status, chips, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const result = stmt.run(
    brand ? String(brand).trim() : null,
    String(model).trim(),
    serial_number ? String(serial_number).trim() : null,
    st,
    chipsJson,
    note ? String(note).trim() : null
  )

  const row = db.prepare('SELECT * FROM circuit_boards WHERE id = ?').get(result.lastInsertRowid) as any
  return parseBoardRow(row)
})
