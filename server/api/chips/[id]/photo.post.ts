/**
 * POST /api/chips/[id]/photo —— 绑定/重扫芯片原件照
 * body: { image: "data:image/jpeg;base64,..." }（扫描预览确认后的 dataURL）
 */
import { db } from '../../../database/init'
import { saveChipPhoto } from '../../../utils/chipPhoto'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: '非法芯片 id' })
  }
  const chip = db.prepare('SELECT id FROM chips WHERE id = ?').get(id)
  if (!chip) {
    throw createError({ statusCode: 404, statusMessage: `芯片 #${id} 不存在` })
  }
  const body = await readBody<{ image?: string }>(event)
  saveChipPhoto(db, id, String(body?.image || ''))
  return { ok: true, photo: `chip-${id}.jpg` }
})
