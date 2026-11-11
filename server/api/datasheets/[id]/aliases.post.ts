import { db } from '../../../database/init'
import { dsParseAliases } from '../../../utils/datasheet'

/**
 * 设置 DS 适用型号规则：POST { aliases: "STC8H*, PY32F002A" }
 * 规则 = 精确型号或前缀通配（尾缀 *），逗号分隔；空串 = 清空（仅本型号）
 */
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: '无效 ID' })
  }
  const body = await readBody<{ aliases?: string }>(event).catch(() => ({}))
  const raw = String(body?.aliases ?? '')
  const rules = dsParseAliases(raw)
  const row = db.prepare('SELECT id FROM datasheets WHERE id = ?').get(id)
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: '该型号没有 Datasheet' })
  }
  db.prepare('UPDATE datasheets SET aliases = ? WHERE id = ?')
    .run(rules.length ? rules.join(',') : null, id)
  return db.prepare('SELECT * FROM datasheets WHERE id = ?').get(id)
})
