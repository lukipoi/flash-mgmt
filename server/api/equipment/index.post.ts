import { db } from '../../database/init'
import type { EquipmentStatus } from '~~/shared/types'

const VALID_STATUSES: EquipmentStatus[] = ['normal', 'damaged', 'lost']

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { brand, model, serial_number, status, note } = body

  if (!model || !String(model).trim()) {
    throw createError({ statusCode: 400, statusMessage: '缺少必填字段: model' })
  }

  const st = VALID_STATUSES.includes(status) ? status : 'normal'

  const stmt = db.prepare(`
    INSERT INTO equipment (brand, model, serial_number, status, note)
    VALUES (?, ?, ?, ?, ?)
  `)
  const result = stmt.run(
    brand ? String(brand).trim() : null,
    String(model).trim(),
    serial_number ? String(serial_number).trim() : null,
    st,
    note ? String(note).trim() : null
  )

  return db.prepare('SELECT * FROM equipment WHERE id = ?').get(result.lastInsertRowid)
})
