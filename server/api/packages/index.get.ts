import { db } from '../../database/init'
import { PACKAGES } from '../../../utils/packages'

/**
 * 封装列表：内置封装 + 手动添加（含给内置补图）合并返回
 */
export default defineEventHandler(() => {
  const rows = db.prepare('SELECT name, aliases, image, created_at FROM packages ORDER BY name').all() as Array<{
    name: string, aliases: string | null, image: string | null, created_at: string
  }>
  const manualByName: Record<string, typeof rows[0]> = {}
  for (const r of rows) manualByName[r.name.toLowerCase()] = r

  const countRows = db.prepare(
    "SELECT lower(package) AS k, COUNT(*) AS c FROM chips WHERE package IS NOT NULL GROUP BY lower(package)"
  ).all() as Array<{ k: string, c: number }>
  const countMap = Object.fromEntries(countRows.map(r => [r.k, r.c]))

  const builtins = PACKAGES.map(p => {
    const manual = manualByName[p.name.toLowerCase()]
    // 手动条目存在 → 允许覆盖内置的图/别名（补图通道）
    return {
      name: p.name,
      aliases: manual?.aliases ?? p.aliases.join(','),
      image: manual?.image ?? p.image ?? null,
      builtin: true,
      chip_count: countMap[p.name.toLowerCase()] ?? 0
    }
  })

  const builtinNames = new Set(PACKAGES.map(p => p.name.toLowerCase()))
  const manuals = rows
    .filter(r => !builtinNames.has(r.name.toLowerCase()))
    .map(r => ({
      name: r.name,
      aliases: r.aliases ?? '',
      image: r.image,
      builtin: false,
      chip_count: countMap[r.name.toLowerCase()] ?? 0
    }))

  return [...builtins, ...manuals]
})
