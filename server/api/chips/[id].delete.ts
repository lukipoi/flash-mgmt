import { db } from '../../database/init'

export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: '无效的芯片 ID' })
  }

  const existing = db.prepare('SELECT id, model FROM chips WHERE id = ?').get(id) as any
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: '芯片不存在' })
  }

  // 先记录销毁日志（再删芯片会级联删除日志，所以先记）
  db.prepare('INSERT INTO operation_logs (chip_id, operation, detail) VALUES (?, ?, ?)')
    .run(id, 'destroy', `销毁芯片档案: ${existing.model}`)

  db.prepare('DELETE FROM chips WHERE id = ?').run(id)

  return { success: true }
})
