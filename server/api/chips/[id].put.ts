import { db } from '../../database/init'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: '无效的芯片 ID' })
  }

  const existing = db.prepare('SELECT * FROM chips WHERE id = ?').get(id) as any
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: '芯片不存在' })
  }

  const body = await readBody(event)

  // 如果修改了 UID，检查唯一性
  if (body.uid && body.uid !== existing.uid) {
    const conflict = db.prepare('SELECT id FROM chips WHERE uid = ? AND id != ?').get(body.uid, id)
    if (conflict) {
      throw createError({ statusCode: 409, statusMessage: `UID "${body.uid}" 已存在` })
    }
  }

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
      'SELECT id FROM chips WHERE location_a = ? AND location_b = ? AND location_c = ? AND id != ?'
    ).get(finalLa, finalLb, finalLc, id)
    if (locDup) {
      throw createError({ statusCode: 409, statusMessage: `库位 "${finalLa}-${finalLb}-${finalLc}" 已被占用` })
    }
  }

  // NOT NULL 字段：空值视为"不想改"，跳过更新，保留数据库原值
  const notNullFields = new Set(['model', 'jedec_id', 'uid'])
  // 库位三级：前端意外清空常见 —— 原值非空 + 新值为空 → 跳过
  const locationFields = new Set(['location_a', 'location_b', 'location_c'])

  // 构建更新字段
  const fields: string[] = []
  const params: any[] = []
  const allowedFields = ['vendor', 'model', 'jedec_id', 'uid', 'uid_length', 'capacity',
    'location_a', 'location_b', 'location_c',
    'sec1_locked', 'sec2_locked', 'sec3_locked', 'sec1_data', 'sec2_data', 'sec3_data', 'note']

  for (const field of allowedFields) {
    if (body[field] === undefined) continue

    // NOT NULL 字段：空字符串或 null → 跳过，不覆盖已有值
    if (notNullFields.has(field)) {
      if (body[field] === null || body[field] === '') continue
      fields.push(`${field} = ?`)
      params.push(body[field])
      continue
    }

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

  fields.push(`updated_at = datetime('now')`)
  params.push(id)

  db.prepare(`UPDATE chips SET ${fields.join(', ')} WHERE id = ?`).run(...params)

  // 插入操作日志
  if (body.note !== undefined) {
    db.prepare('INSERT INTO operation_logs (chip_id, operation, detail) VALUES (?, ?, ?)')
      .run(id, 'update_note', `修改备注: ${body.note}`)
  }
  const otherFields = Object.keys(body).filter(k => k !== 'note')
  if (otherFields.length) {
    db.prepare('INSERT INTO operation_logs (chip_id, operation, detail) VALUES (?, ?, ?)')
      .run(id, 'update', `修改字段: ${otherFields.join(', ')}`)
  }

  return db.prepare('SELECT * FROM chips WHERE id = ?').get(id)
})
