import { db } from '../../database/init'

export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: '无效的芯片 ID' })
  }

  const chip = db.prepare('SELECT * FROM chips WHERE id = ?').get(id)
  if (!chip) {
    throw createError({ statusCode: 404, statusMessage: '芯片不存在' })
  }

  const logs = db.prepare('SELECT * FROM operation_logs WHERE chip_id = ? ORDER BY created_at DESC').all(id)

  return { ...chip, operation_logs: logs }
})
