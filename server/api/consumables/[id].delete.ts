import { db } from '../../database/init'

export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: '无效的耗材 ID' })
  }

  const existing = db.prepare('SELECT id FROM consumables WHERE id = ?').get(id)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: '耗材不存在' })
  }

  db.prepare('DELETE FROM consumables WHERE id = ?').run(id)

  return { success: true }
})
