/**
 * GET /api/chips/[id]/photo —— 芯片原件照（JPEG 流）
 * photo 列为空或文件丢失 → 404。no-store（重扫后同 URL 内容会变）。
 */
import { readChipPhoto } from '../../../utils/chipPhoto'
import { db } from '../../../database/init'

export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: '非法芯片 id' })
  }
  const buf = readChipPhoto(db, id)
  if (!buf) {
    throw createError({ statusCode: 404, statusMessage: '该芯片没有原件照片' })
  }
  setResponseHeaders(event, {
    'Content-Type': 'image/jpeg',
    'Content-Length': String(buf.length),
    'Cache-Control': 'no-store',
  })
  return buf
})
