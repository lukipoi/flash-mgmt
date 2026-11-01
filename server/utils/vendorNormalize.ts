import { db } from '../database/init'
import { findBrand } from '../../utils/brands'

/**
 * server 端厂商名归一化：内置表（utils/brands.ts）+ 手动品牌表（brands）两级匹配
 * - 命中内置或手动别名/规范名 → 返回规范名
 * - 未命中返回 trim 原文
 */
export function normalizeVendorDb(vendor: string | null | undefined): string {
  const trimmed = (vendor ?? '').trim()
  if (!trimmed) return ''

  // 1. 内置品牌表（同步、无 IO）
  const builtin = findBrand(trimmed)
  if (builtin) return builtin.name

  // 2. 手动品牌表（品牌数量少，全表匹配即可）
  const key = trimmed.toLowerCase()
  const rows = db.prepare('SELECT name, aliases FROM brands').all() as Array<{ name: string, aliases: string | null }>
  for (const r of rows) {
    const keys = [r.name, ...(r.aliases ?? '').split(',')]
    if (keys.some(k => k.trim().toLowerCase() === key)) return r.name
  }

  return trimmed
}
