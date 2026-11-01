import { db } from '../../database/init'
import { LCSC_CHIP_CATEGORIES } from '../../utils/lcscCategories'

/**
 * 一键导入立创商城芯片分类（两级，幂等：已存在的分类跳过）
 */
export default defineEventHandler(() => {
  const findByName = db.prepare('SELECT id, parent_id FROM chip_categories WHERE lower(name) = lower(?)')
  const insert = db.prepare('INSERT INTO chip_categories (name, parent_id) VALUES (?, ?)')

  let roots = 0
  let children = 0
  db.exec('BEGIN')
  try {
    for (const root of LCSC_CHIP_CATEGORIES) {
      let row = findByName.get(root.name) as { id: number, parent_id: number | null } | undefined
      if (!row) {
        const res = insert.run(root.name, null)
        row = { id: Number(res.lastInsertRowid), parent_id: null }
        roots++
      }
      for (const child of root.children) {
        if (findByName.get(child)) continue
        insert.run(child, row.id)
        children++
      }
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  return { roots, children }
})
