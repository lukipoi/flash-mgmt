import { db } from '../../database/init'
import type { ConsumableStatus } from '~~/shared/types'

const VALID_STATUSES: ConsumableStatus[] = ['in_use', 'in_stock']

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { brand, model, serial_number, barcode, location_a, location_b, location_c, status, shelf_life, production_date, expiry_date, batch_number, exec_standard, net_content, note, quantity } = body

  if (!model || !String(model).trim()) {
    throw createError({ statusCode: 400, statusMessage: '缺少必填字段: model' })
  }

  const st = VALID_STATUSES.includes(status) ? status : 'in_stock'
  const qty = Math.min(Math.max(parseInt(quantity, 10) || 1, 1), 200)

  const la = location_a ? String(location_a).trim() : null
  const lb = location_b ? String(location_b).trim() : null
  const lc = location_c ? String(location_c).trim() : null

  // 批量录入时库位序号必须可递增：lc 留空（自动取最大+1 起）或为数字
  if (qty > 1 && la && lb && lc && !/^\d+$/.test(lc)) {
    throw createError({ statusCode: 400, statusMessage: '批量录入时库位序号必须为数字（或留空自动递增）' })
  }

  // 起始序号：lc 填了就用它；la+lb 填了但 lc 空 → 同组最大 +1
  let lcStart: number | null = null
  if (la && lb) {
    if (lc) {
      lcStart = parseInt(lc, 10)
    } else {
      const rows = db.prepare(
        'SELECT location_c FROM consumables WHERE location_a = ? AND location_b = ?'
      ).all(la, lb) as any[]
      let maxN = 0
      for (const r of rows) {
        const n = parseInt(r.location_c, 10)
        if (!isNaN(n) && n > maxN) maxN = n
      }
      lcStart = maxN + 1
    }
  }

  const stmt = db.prepare(`
    INSERT INTO consumables (brand, model, serial_number, barcode, location_a, location_b, location_c, status, shelf_life, production_date, expiry_date, batch_number, exec_standard, net_content, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const dupCheck = db.prepare(
    'SELECT id FROM consumables WHERE location_a = ? AND location_b = ? AND location_c = ?'
  )

  const created: any[] = []
  // node:sqlite 没有 .transaction()（那是 better-sqlite3 的 API），手动 BEGIN/COMMIT
  db.exec('BEGIN IMMEDIATE')
  try {
    for (let i = 0; i < qty; i++) {
      const curLc = lcStart !== null ? String(lcStart + i) : lc
      // 库位唯一性（三字段都非空时）
      if (la && lb && curLc) {
        if (dupCheck.get(la, lb, curLc)) {
          throw createError({ statusCode: 409, statusMessage: `库位 "${la}-${lb}-${curLc}" 已被占用` })
        }
      }
      const result = stmt.run(
        brand ? String(brand).trim() : null,
        String(model).trim(),
        serial_number ? String(serial_number).trim() : null,
        barcode ? String(barcode).trim() : null,
        la, lb, curLc,
        st,
        shelf_life ? String(shelf_life).trim() : null,
        production_date ? String(production_date).trim() : null,
        expiry_date ? String(expiry_date).trim() : null,
        batch_number ? String(batch_number).trim() : null,
        exec_standard ? String(exec_standard).trim() : null,
        net_content ? String(net_content).trim() : null,
        note ? String(note).trim() : null
      )
      created.push(db.prepare('SELECT * FROM consumables WHERE id = ?').get(result.lastInsertRowid))
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }

  return qty === 1 ? created[0] : created
})
