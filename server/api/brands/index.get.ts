import { db } from '../../database/init'
import { BRANDS } from '../../../utils/brands'

/**
 * 品牌列表：内置品牌（utils/brands.ts）+ 手动添加品牌（brands 表）合并返回，带芯片计数
 */
export default defineEventHandler(() => {
  const rows = db.prepare('SELECT name, aliases, logo, created_at FROM brands ORDER BY name').all() as Array<{
    name: string, aliases: string | null, logo: string | null, created_at: string
  }>

  const countRows = db.prepare(
    "SELECT lower(vendor) AS k, COUNT(*) AS c FROM chips WHERE vendor IS NOT NULL GROUP BY lower(vendor)"
  ).all() as Array<{ k: string, c: number }>
  const countMap = Object.fromEntries(countRows.map(r => [r.k, r.c]))

  // 手动条目按 lower(name) 覆盖内置的 logo/aliases（用户可给内置品牌补 logo/补别名）
  const manualByName = new Map(rows.map(r => [r.name.toLowerCase(), r]))

  const merged = BRANDS.map(b => {
    const manual = manualByName.get(b.name.toLowerCase())
    manualByName.delete(b.name.toLowerCase())
    return {
      name: b.name,
      aliases: manual?.aliases ?? b.aliases.join(','),
      logo: manual?.logo ?? b.logo ?? null,
      builtin: true,
      chip_count: countMap[b.name.toLowerCase()] ?? 0
    }
  })

  // 剩余纯手动品牌（未与内置重名）
  for (const r of manualByName.values()) {
    merged.push({
      name: r.name,
      aliases: r.aliases ?? '',
      logo: r.logo,
      builtin: false,
      chip_count: countMap[r.name.toLowerCase()] ?? 0
    })
  }

  return merged
})
