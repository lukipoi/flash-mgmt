import { db } from '../../../database/init'

/** 版本历史：GET /api/datasheets/:id/versions（新→旧排列，含当前版本标记） */
export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: '无效 ID' })
  }
  const row = db.prepare('SELECT current_ver FROM datasheets WHERE id = ?').get(id) as { current_ver: number | null } | undefined
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: '该型号没有 Datasheet' })
  }
  const rows = db.prepare('SELECT * FROM datasheet_versions WHERE ds_id = ? ORDER BY id DESC').all(id) as
    | Array<{ id: number, ds_id: number, version: string | null, original_name: string | null, size: number | null, uploaded_at: string }>
  return rows.map(r => ({ ...r, is_current: r.id === row.current_ver }))
})
