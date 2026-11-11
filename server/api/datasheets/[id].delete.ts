import { db } from '../../database/init'
import { rmSync } from 'node:fs'
import { dsFilePath, dsVersionFilePath } from '../../utils/datasheet'

/** 删除型号 Datasheet（记录 + 全部版本文件；同型号所有芯片随之失去关联） */
export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: '无效 ID' })
  }
  const row = db.prepare('SELECT id FROM datasheets WHERE id = ?').get(id)
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: '该型号没有 Datasheet' })
  }
  const vers = db.prepare('SELECT id FROM datasheet_versions WHERE ds_id = ?').all(id) as Array<{ id: number }>
  db.prepare('DELETE FROM datasheet_versions WHERE ds_id = ?').run(id)
  db.prepare('DELETE FROM datasheets WHERE id = ?').run(id)
  try { rmSync(dsFilePath(id), { force: true }) } catch { /* 文件清理失败不阻塞 */ }
  for (const v of vers) {
    try { rmSync(dsVersionFilePath(v.id), { force: true }) } catch { /* 同上 */ }
  }
  return { ok: true }
})
