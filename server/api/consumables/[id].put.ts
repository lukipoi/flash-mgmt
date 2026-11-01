import { db } from '../../database/init'
import type { ConsumableStatus } from '~~/shared/types'

const VALID_STATUSES: ConsumableStatus[] = ['in_use', 'in_stock']

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: '无效的耗材 ID' })
  }

  const existing = db.prepare('SELECT * FROM consumables WHERE id = ?').get(id) as any
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: '耗材不存在' })
  }

  const body = await readBody(event)

  // 库位唯一性检查（三字段都非空时，排除自身）
  const finalLa = body.location_a !== undefined
    ? (body.location_a ? String(body.location_a).trim() : null)
    : existing.location_a
  const finalLb = body.location_b !== undefined
    ? (body.location_b ? String(body.location_b).trim() : null)
    : existing.location_b
  const finalLc = body.location_c !== undefined
    ? (body.location_c ? String(body.location_c).trim() : null)
    : existing.location_c
  if (finalLa && finalLb && finalLc) {
    const locDup = db.prepare(
      'SELECT id FROM consumables WHERE location_a = ? AND location_b = ? AND location_c = ? AND id != ?'
    ).get(finalLa, finalLb, finalLc, id)
    if (locDup) {
      throw createError({ statusCode: 409, statusMessage: `库位 "${finalLa}-${finalLb}-${finalLc}" 已被占用` })
    }
  }

  const fields: string[] = []
  const params: any[] = []
  const allowedFields = ['brand', 'model', 'serial_number', 'barcode', 'location_a', 'location_b', 'location_c', 'status', 'shelf_life', 'production_date', 'expiry_date', 'batch_number', 'exec_standard', 'net_content', 'note']
  const locationFields = new Set(['location_a', 'location_b', 'location_c'])

  for (const field of allowedFields) {
    if (body[field] === undefined) continue
    if (field === 'status' && !VALID_STATUSES.includes(body[field])) continue

    let val = body[field] === '' ? null : body[field]
    if (val !== null && locationFields.has(field)) {
      val = String(val).trim() || null
    }

    // 库位保护：原值非空，新值为空 → 跳过（前端编辑弹窗意外清空常见）
    if (locationFields.has(field) && val === null) {
      if (existing[field] !== null && existing[field] !== '') continue
    }

    fields.push(`${field} = ?`)
    params.push(val)
  }

  if (fields.length === 0) {
    return db.prepare('SELECT * FROM consumables WHERE id = ?').get(id)
  }

  fields.push(`updated_at = datetime('now')`)
  params.push(id)

  db.prepare(`UPDATE consumables SET ${fields.join(', ')} WHERE id = ?`).run(...params)

  return db.prepare('SELECT * FROM consumables WHERE id = ?').get(id)
})
