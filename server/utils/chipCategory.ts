import { db } from '../database/init'

/**
 * 芯片类型名归一：大小写/首尾空格 → chip_categories 表中的规范名
 * 只接受二级分类（parent_id 非空）；未登记或选的是一级分类都返回 null
 */
export function normalizeChipCategory(name: string | null | undefined): string | null {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return null
  const row = db.prepare(
    'SELECT name FROM chip_categories WHERE lower(name) = lower(?) AND parent_id IS NOT NULL'
  ).get(trimmed) as { name: string } | undefined
  return row?.name ?? null
}
