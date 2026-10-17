import { db } from '../../database/init'
import type { ConsumableStatus } from '~~/shared/types'

const VALID_STATUSES: ConsumableStatus[] = ['in_use', 'in_stock']

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { brand, model, serial_number, barcode, location_a, location_b, location_c, status, shelf_life, production_date, exec_standard, net_content, note } = body

  if (!model || !String(model).trim()) {
    throw createError({ statusCode: 400, statusMessage: '缺少必填字段: model' })
  }

  const st = VALID_STATUSES.includes(status) ? status : 'in_stock'

  // 检查库位唯一性（三字段都非空时）
  const la = location_a ? String(location_a).trim() : null
  const lb = location_b ? String(location_b).trim() : null
  const lc = location_c ? String(location_c).trim() : null
  if (la && lb && lc) {
    const locDup = db.prepare(
      'SELECT id FROM consumables WHERE location_a = ? AND location_b = ? AND location_c = ?'
    ).get(la, lb, lc)
    if (locDup) {
      throw createError({ statusCode: 409, statusMessage: `库位 "${la}-${lb}-${lc}" 已被占用` })
    }
  }

  const stmt = db.prepare(`
    INSERT INTO consumables (brand, model, serial_number, barcode, location_a, location_b, location_c, status, shelf_life, production_date, exec_standard, net_content, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const result = stmt.run(
    brand ? String(brand).trim() : null,
    String(model).trim(),
    serial_number ? String(serial_number).trim() : null,
    barcode ? String(barcode).trim() : null,
    la, lb, lc,
    st,
    shelf_life ? String(shelf_life).trim() : null,
    production_date ? String(production_date).trim() : null,
    exec_standard ? String(exec_standard).trim() : null,
    net_content ? String(net_content).trim() : null,
    note ? String(note).trim() : null
  )

  return db.prepare('SELECT * FROM consumables WHERE id = ?').get(result.lastInsertRowid)
})
