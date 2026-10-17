import { db } from '../../database/init'

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

export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: '无效的电路板 ID' })
  }

  const row = db.prepare('SELECT * FROM circuit_boards WHERE id = ?').get(id) as any
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: '电路板不存在' })
  }

  return parseBoardRow(row)
})
