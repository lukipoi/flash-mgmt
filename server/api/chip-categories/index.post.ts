import { db } from '../../database/init'

/** 新增芯片类型 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const name = String(body?.name ?? '').trim()
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: '芯片类型名必填' })
  }

  // parent_id 为空 = 一级分类；否则必须挂在一个一级分类下（仅支持两层）
  let parentId: number | null = null
  if (body?.parent_id !== undefined && body?.parent_id !== null && body?.parent_id !== '') {
    parentId = Number(body.parent_id)
    if (isNaN(parentId)) {
      throw createError({ statusCode: 400, statusMessage: '无效的上级分类' })
    }
    const parent = db.prepare('SELECT id, parent_id FROM chip_categories WHERE id = ?').get(parentId) as
      { id: number, parent_id: number | null } | undefined
    if (!parent) {
      throw createError({ statusCode: 404, statusMessage: '上级分类不存在' })
    }
    if (parent.parent_id !== null) {
      throw createError({ statusCode: 400, statusMessage: '仅支持两级分类，二级分类下不能再建子类' })
    }
  }

  const dup = db.prepare('SELECT id FROM chip_categories WHERE lower(name) = lower(?)').get(name)
  if (dup) {
    throw createError({ statusCode: 409, statusMessage: `芯片类型 "${name}" 已存在` })
  }

  const result = db.prepare('INSERT INTO chip_categories (name, parent_id) VALUES (?, ?)').run(name, parentId)
  return db.prepare('SELECT id, name, parent_id, created_at FROM chip_categories WHERE id = ?').get(result.lastInsertRowid)
})
