import { db } from '../../../database/init'

/**
 * 回滚到历史版本：POST /api/datasheets/:id/revert  body: { verId }
 * 把当前指针切回指定版本（历史版本始终保留，可随时再切回）
 */
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: '无效 ID' })
  }
  const body = await readBody<{ verId?: number }>(event).catch(() => ({}))
  const verId = Number(body?.verId)
  if (!Number.isInteger(verId) || verId <= 0) {
    throw createError({ statusCode: 400, statusMessage: '缺少 verId' })
  }
  const ver = db.prepare('SELECT * FROM datasheet_versions WHERE id = ? AND ds_id = ?').get(verId, id) as
    | { id: number, version: string | null, original_name: string | null, size: number | null }
    | undefined
  if (!ver) {
    throw createError({ statusCode: 404, statusMessage: '版本不存在' })
  }
  db.prepare(`UPDATE datasheets SET current_ver = ?, version = ?, original_name = ?, size = ?,
    uploaded_at = datetime('now') WHERE id = ?`)
    .run(ver.id, ver.version, ver.original_name, ver.size, id)
  return { ok: true }
})
