import { db } from '../../database/init'
import { jedecIdToVendor } from '~~/utils/format'

/** 单条核查结果 */
interface BackfillItem {
  id: number
  model: string
  jedec_id: string | null
  current_vendor: string | null
  suggested_vendor: string | null
  /**
   * ok           : 已有厂商，和推荐值一致
   * auto_fill    : 原厂商为空，有推荐值 → 可以自动填入
   * conflict     : 原厂商非空，推荐值不同 → 需要人工确认
   * ok_manual    : 原厂商非空，但 JEDEC/型号没匹配到 → 保留人工值
   * unknown      : 原厂商为空，JEDEC/型号也没匹配到 → 需要手动填
   */
  status: 'ok' | 'auto_fill' | 'conflict' | 'ok_manual' | 'unknown'
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event) || {}
  // apply=true 才真的写库，否则只返回核查结果
  const apply = !!body.apply

  const rows = db.prepare('SELECT id, model, jedec_id, vendor FROM chips ORDER BY id').all() as any[]

  const results: BackfillItem[] = []
  let autoFillCount = 0
  let conflictCount = 0
  let unknownCount = 0

  for (const row of rows) {
    const suggested = jedecIdToVendor(row.jedec_id || '', row.model || '')
    const current = row.vendor?.trim() || null

    let status: BackfillItem['status']
    if (current) {
      if (suggested) {
        // 都有值，看是否一致
        if (suggested.toLowerCase() === current.toLowerCase()) {
          status = 'ok'
        } else {
          status = 'conflict'
          conflictCount++
        }
      } else {
        status = 'ok_manual'
      }
    } else {
      // 当前厂商为空
      if (suggested) {
        status = 'auto_fill'
        autoFillCount++
      } else {
        status = 'unknown'
        unknownCount++
      }
    }

    results.push({
      id: row.id,
      model: row.model,
      jedec_id: row.jedec_id,
      current_vendor: current,
      suggested_vendor: suggested || null,
      status,
    })
  }

  // 真写库：只自动填 auto_fill，不碰 conflict 的（安全）
  if (apply) {
    const update = db.prepare('UPDATE chips SET vendor = ?, updated_at = datetime(\'now\') WHERE id = ?')
    let updated = 0
    for (const r of results) {
      if (r.status === 'auto_fill' && r.suggested_vendor) {
        update.run(r.suggested_vendor, r.id)
        updated++
      }
    }
    return {
      applied: true,
      updated,
      conflictCount,
      unknownCount,
      results,
    }
  }

  return {
    applied: false,
    total: rows.length,
    autoFillCount,
    conflictCount,
    unknownCount,
    results,
  }
})
