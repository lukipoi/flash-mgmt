import { db } from '../../database/init'
import { normalizeUid, normalizeJedecId, isNoUid } from '~~/utils/format'
import { normalizeVendorDb } from '../../utils/vendorNormalize'
import { normalizePackageDb } from '../../utils/packageNormalize'
import { normalizeChipCategory } from '../../utils/chipCategory'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { vendor, model, chip_type, jedec_id, uid, uid_length, capacity, package: pkg, chip_category,
    qty_per_bag,
    location_a, location_b, location_c,
    sec1_locked, sec2_locked, sec3_locked, sec1_data, sec2_data, sec3_data, note } = body

  if (!model) {
    throw createError({ statusCode: 400, statusMessage: '缺少必填字段: model' })
  }

  const type = (['flash', 'mcu', 'other'].includes(chip_type) ? chip_type : 'flash') as 'flash' | 'mcu' | 'other'

  // Flash 必须有 JEDEC ID；MCU / 其他类型不需要
  if (type === 'flash' && !jedec_id) {
    throw createError({ statusCode: 400, statusMessage: 'Flash 芯片必填 JEDEC ID' })
  }

  // Flash / MCU 必须填 UID；其他类型 UID 可选
  if (type !== 'other' && !uid) {
    throw createError({ statusCode: 400, statusMessage: '缺少必填字段: uid' })
  }

  // 其他类型不保留 JEDEC ID / 容量，但必须选择芯片类型（chip_categories 列表）
  const normJedecId = type === 'other' ? '' : (jedec_id ? normalizeJedecId(jedec_id as string) : '')
  const normUid = uid ? normalizeUid(uid as string) : ''
  const category = type === 'other' ? normalizeChipCategory(chip_category) : null
  if (type === 'other' && !category) {
    throw createError({ statusCode: 400, statusMessage: '「其他」类型必须选择芯片类型' })
  }

  // 单包颗数：仅「其他」类型 + 未填 UID 才允许 > 1，其余一律 1
  const hasUid = !!normUid && !isNoUid(normUid)
  let qty = 1
  if (type === 'other' && !hasUid) {
    const n = Number(qty_per_bag)
    if (qty_per_bag !== undefined && qty_per_bag !== null && qty_per_bag !== '') {
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
        throw createError({ statusCode: 400, statusMessage: '单包颗数必须是 ≥ 1 的整数' })
      }
      qty = n
    }
  }

  // 检查 UID 唯一性（无 UID 时不检查，SQLite 中多个 NULL 不冲突；"/" 表示无 UID，同样跳过）
  if (normUid && !isNoUid(normUid)) {
    const existing = db.prepare('SELECT id FROM chips WHERE uid = ?').get(normUid)
    if (existing) {
      throw createError({ statusCode: 409, statusMessage: `UID "${normUid}" 已存在` })
    }
  }

  // 检查库位唯一性（三字段都非空时）
  const la = location_a ? String(location_a).trim() : null
  const lb = location_b ? String(location_b).trim() : null
  const lc = location_c ? String(location_c).trim() : null
  if (la && lb && lc) {
    const locDup = db.prepare(
      'SELECT id FROM chips WHERE location_a = ? AND location_b = ? AND location_c = ?'
    ).get(la, lb, lc)
    if (locDup) {
      throw createError({ statusCode: 409, statusMessage: `库位 "${la}-${lb}-${lc}" 已被占用` })
    }
  }

  const stmt = db.prepare(`
    INSERT INTO chips (vendor, model, chip_type, jedec_id, uid, uid_length, capacity, package, chip_category,
      location_a, location_b, location_c, qty_per_bag,
      sec1_locked, sec2_locked, sec3_locked, sec1_data, sec2_data, sec3_data, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const result = stmt.run(
    vendor ? normalizeVendorDb(String(vendor)) || null : null,
    model, type, normJedecId, isNoUid(normUid) ? null : (normUid || null), isNoUid(normUid) ? 0 : (uid_length ?? 8),
    type === 'other' ? null : (capacity ?? null),
    pkg ? normalizePackageDb(String(pkg)) || null : null,
    category,
    la, lb, lc, qty,
    sec1_locked ?? 0, sec2_locked ?? 0, sec3_locked ?? 0,
    sec1_data ?? null, sec2_data ?? null, sec3_data ?? null, note ?? null
  )

  // 返回创建的记录
  return db.prepare('SELECT * FROM chips WHERE id = ?').get(result.lastInsertRowid)
})
