import { db } from '../../database/init'

/** 删除芯片类型（仍被芯片引用时拒绝） */
export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: '无效的类型 ID' })
  }

  const existing = db.prepare('SELECT id, name FROM chip_categories WHERE id = ?').get(id) as
    { id: number, name: string } | undefined
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: '芯片类型不存在' })
  }

  const kids = db.prepare('SELECT COUNT(*) AS c FROM chip_categories WHERE parent_id = ?').get(id) as { c: number }
  if (kids.c > 0) {
    throw createError({ statusCode: 409, statusMessage: `该一级分类下还有 ${kids.c} 个二级分类，请先删除二级分类` })
  }

  const used = db.prepare(
    'SELECT COUNT(*) AS c FROM chips WHERE chip_type = \'other\' AND lower(chip_category) = lower(?)'
  ).get(existing.name) as { c: number }

  if (used.c > 0) {
    throw createError({ statusCode: 409, statusMessage: `该类型下仍有 ${used.c} 颗芯片，无法删除` })
  }

  db.prepare('DELETE FROM chip_categories WHERE id = ?').run(id)
  return { ok: true }
})
