import { db } from '../../database/init'

/** 芯片类型列表（「其他」类型芯片的分类），带使用数量 */
export default defineEventHandler(() => {
  const rows = db.prepare('SELECT id, name, parent_id, created_at FROM chip_categories ORDER BY name').all() as Array<{
    id: number, name: string, parent_id: number | null, created_at: string
  }>

  const countRows = db.prepare(
    "SELECT lower(chip_category) AS k, COUNT(*) AS c FROM chips WHERE chip_type = 'other' AND chip_category IS NOT NULL GROUP BY lower(chip_category)"
  ).all() as Array<{ k: string, c: number }>
  const countMap = Object.fromEntries(countRows.map(r => [r.k, r.c]))

  return rows.map(r => ({
    ...r,
    chip_count: countMap[r.name.toLowerCase()] ?? 0
  }))
})
