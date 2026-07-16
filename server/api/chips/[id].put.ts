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

  // 构建更新字段
  const fields: string[] = []
  const params: any[] = []
  const allowedFields = ['model', 'jedec_id', 'uid', 'uid_length', 'capacity',
    'sec1_locked', 'sec2_locked', 'sec3_locked', 'sec1_data', 'sec2_data', 'sec3_data', 'note']

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      fields.push(`${field} = ?`)
      params.push(body[field])
    }
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
