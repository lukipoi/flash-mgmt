/**
 * DELETE /api/chips/[id]/photo —— 删除芯片原件照（文件 + photo 列）
 */
import { db } from '../../../database/init'
import { removeChipPhoto } from '../../../utils/chipPhoto'

export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: '非法芯片 id' })
  }
  removeChipPhoto(db, id)
  return { ok: true }
})
