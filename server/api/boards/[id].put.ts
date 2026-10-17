import { db } from '../../database/init'
import type { CircuitBoardStatus } from '~~/shared/types'

const VALID_STATUSES: CircuitBoardStatus[] = ['pending', 'partial', 'done']

function serializeChips(chips: any): string | null {
  if (chips === undefined) return undefined  // undefined 表示前端没传，保留原值
  if (chips === null) return null            // 显式 null 表示清空
  if (Array.isArray(chips)) {
    const cleaned = chips
      .map((c: any) => String(c).trim())
      .filter((c: string) => c.length > 0)
    if (cleaned.length === 0) return null
    return JSON.stringify(cleaned)
  }
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
  const id = Number(getRouterParam(event, 'id'))
  if (isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: '无效的电路板 ID' })
  }

  const existing = db.prepare('SELECT id FROM circuit_boards WHERE id = ?').get(id)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: '电路板不存在' })
  }

  const body = await readBody(event)

  const fields: string[] = []
  const params: any[] = []
  const allowedFields = ['brand', 'model', 'serial_number', 'status', 'note']

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      if (field === 'status' && !VALID_STATUSES.includes(body[field])) continue
      fields.push(`${field} = ?`)
      params.push(body[field] === '' ? null : body[field])
    }
  }

  // chips 单独处理 JSON 序列化
  if (body.chips !== undefined) {
    const chipsJson = serializeChips(body.chips)
    fields.push('chips = ?')
    params.push(chipsJson)
  }

  if (fields.length === 0) {
    const row = db.prepare('SELECT * FROM circuit_boards WHERE id = ?').get(id) as any
    return parseBoardRow(row)
  }

  fields.push(`updated_at = datetime('now')`)
  params.push(id)

  db.prepare(`UPDATE circuit_boards SET ${fields.join(', ')} WHERE id = ?`).run(...params)

  const row = db.prepare('SELECT * FROM circuit_boards WHERE id = ?').get(id) as any
  return parseBoardRow(row)
})
