import { db } from '../../database/init'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { model, jedec_id, uid, uid_length, capacity,
    sec1_locked, sec2_locked, sec3_locked, sec1_data, sec2_data, sec3_data, note } = body

  if (!model || !jedec_id || !uid) {
    throw createError({ statusCode: 400, statusMessage: '缺少必填字段: model, jedec_id, uid' })
  }

  // 检查 UID 唯一性
  const existing = db.prepare('SELECT id FROM chips WHERE uid = ?').get(uid)
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: `UID "${uid}" 已存在` })
  }

  const stmt = db.prepare(`
    INSERT INTO chips (model, jedec_id, uid, uid_length, capacity,
      sec1_locked, sec2_locked, sec3_locked, sec1_data, sec2_data, sec3_data, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const result = stmt.run(
    model, jedec_id, uid, uid_length ?? 8, capacity ?? null,
    sec1_locked ?? 0, sec2_locked ?? 0, sec3_locked ?? 0,
    sec1_data ?? null, sec2_data ?? null, sec3_data ?? null, note ?? null
  )

  // 返回创建的记录
  return db.prepare('SELECT * FROM chips WHERE id = ?').get(result.lastInsertRowid)
})
