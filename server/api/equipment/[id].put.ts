import { db } from '../../database/init'
import type { EquipmentStatus } from '~~/shared/types'

const VALID_STATUSES: EquipmentStatus[] = ['normal', 'damaged', 'lost']

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: '无效的设备 ID' })
  }

  const existing = db.prepare('SELECT id FROM equipment WHERE id = ?').get(id)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: '设备不存在' })
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

  if (fields.length === 0) {
    return db.prepare('SELECT * FROM equipment WHERE id = ?').get(id)
  }

  fields.push(`updated_at = datetime('now')`)
  params.push(id)

  db.prepare(`UPDATE equipment SET ${fields.join(', ')} WHERE id = ?`).run(...params)

  return db.prepare('SELECT * FROM equipment WHERE id = ?').get(id)
})
