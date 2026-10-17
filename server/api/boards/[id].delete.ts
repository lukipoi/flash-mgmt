import { db } from '../../database/init'

export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: '无效的电路板 ID' })
  }

  const existing = db.prepare('SELECT id FROM circuit_boards WHERE id = ?').get(id)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: '电路板不存在' })
  }

  db.prepare('DELETE FROM circuit_boards WHERE id = ?').run(id)

  return { success: true }
})
