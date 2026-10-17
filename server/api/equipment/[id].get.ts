import { db } from '../../database/init'

export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: '无效的设备 ID' })
  }

  const eq = db.prepare('SELECT * FROM equipment WHERE id = ?').get(id)
  if (!eq) {
    throw createError({ statusCode: 404, statusMessage: '设备不存在' })
  }

  return eq
})
