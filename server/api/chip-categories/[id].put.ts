import { db } from '../../database/init'

/** 重命名芯片类型，并级联更新引用它的芯片 */
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: '无效的类型 ID' })
  }

  const existing = db.prepare('SELECT id, name FROM chip_categories WHERE id = ?').get(id) as
    { id: number, name: string } | undefined
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: '芯片类型不存在' })
  }

  const body = await readBody(event)
  const name = String(body?.name ?? '').trim()
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: '芯片类型名必填' })
  }

  const dup = db.prepare('SELECT id FROM chip_categories WHERE lower(name) = lower(?) AND id != ?').get(name, id)
  if (dup) {
    throw createError({ statusCode: 409, statusMessage: `芯片类型 "${name}" 已存在` })
  }

  db.exec('BEGIN')
  try {
    db.prepare('UPDATE chip_categories SET name = ?, updated_at = datetime(\'now\') WHERE id = ?').run(name, id)
    // 芯片存的是类型名，改名需同步，避免档案失配
    db.prepare('UPDATE chips SET chip_category = ? WHERE lower(chip_category) = lower(?)').run(name, existing.name)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  return db.prepare('SELECT id, name, created_at FROM chip_categories WHERE id = ?').get(id)
})
