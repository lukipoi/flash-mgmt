import { db } from '../database/init'
import { findPackage } from '../../utils/packages'

/**
 * server 端封装名归一化：内置表 + 手动封装表两级匹配
 */
export function normalizePackageDb(pkg: string | null | undefined): string {
  const trimmed = (pkg ?? '').trim()
  if (!trimmed) return ''

  const builtin = findPackage(trimmed)
  if (builtin) return builtin.name

  const key = trimmed.toLowerCase()
  const rows = db.prepare('SELECT name, aliases FROM packages').all() as Array<{ name: string, aliases: string | null }>
  for (const r of rows) {
    const keys = [r.name, ...(r.aliases ?? '').split(',')]
    if (keys.some(k => k.trim().toLowerCase() === key)) return r.name
  }

  return trimmed
}
