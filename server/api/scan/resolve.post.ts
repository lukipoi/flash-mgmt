import { db } from '../../database/init'

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase()

/**
 * 解析标签二维码文本，返回物品类型 + id
 * 标签内容沿用原有 "|" 分隔格式，编号以 #id 形式嵌在里面：
 *   chip:       model|jedec|uid|#id
 *   equipment:  brand|model|sn|#id
 *   consumable: brand|model|#id|sn
 *   board:      brand|model|chips|#id
 *   container:  big|A 或 small|A-B
 * 类型无法从文本直接得到，用 #id 定位记录并比对各字段来判定。
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const raw = String(body?.text || '').trim()
  if (!raw) throw createError({ statusCode: 400, statusMessage: '扫码内容为空' })

  const container = raw.match(/^(big|small)\|(.+)$/)
  if (container) return { kind: 'container', name: container[2].trim() }

  const idMatch = raw.match(/#(\d+)/)
  if (!idMatch) throw createError({ statusCode: 404, statusMessage: '二维码中未找到编号' })
  const id = Number(idMatch[1])

  const tokens = raw.split('|').map(t => t.trim())
  const t0 = norm(tokens[0])
  const t1 = norm(tokens[1])

  type Hit = { kind: string; id: number; score: number }
  const hits: Hit[] = []
  const existing: string[] = []

  const chip = db.prepare('SELECT * FROM chips WHERE id = ?').get(id) as any
  if (chip) {
    existing.push('chip')
    // 芯片二维码：model|jedec|uid|#id
    let score = 0
    if (t0 && norm(chip.model) === t0) score += 2
    if (t1 && norm(chip.jedec_id) === t1) score += 1
    if (tokens[2] && norm(chip.uid) === norm(tokens[2])) score += 2
    if (score > 0) hits.push({ kind: 'chip', id, score })
  }

  const tables: Array<[string, string]> = [
    ['equipment', 'equipment'],
    ['consumable', 'consumables'],
    ['board', 'circuit_boards'],
  ]
  for (const [kind, table] of tables) {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as any
    if (!row) continue
    existing.push(kind)
    // 其余类别二维码：brand|model|...#id
    let score = 0
    if (t0 && norm(row.brand) === t0) score += 1
    if (t1 && norm(row.model) === t1) score += 2
    // 第三段：设备是序列号，耗材另有 barcode，电路板是芯片清单
    if (kind === 'board') {
      const joined = norm(Array.isArray(row.chips) ? row.chips.join(',') : row.chips)
      if (joined && joined === norm(tokens[2])) score += 2
    } else {
      if (tokens[2] && norm(row.serial_number) === norm(tokens[2])) score += 2
      if (tokens[3] && norm(row.serial_number) === norm(tokens[3])) score += 2
    }
    if (score > 0) hits.push({ kind, id, score })
  }

  if (hits.length) {
    hits.sort((a, b) => b.score - a.score)
    return { kind: hits[0].kind, id }
  }

  // 字段没对上但该 id 只存在于一张表时，仍认为是它
  if (existing.length === 1) return { kind: existing[0], id }

  throw createError({ statusCode: 404, statusMessage: '未找到匹配的物品' })
})
