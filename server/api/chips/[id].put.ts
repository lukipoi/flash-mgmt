import { db } from '../../database/init'
import { normalizeUid, isNoUid } from '~~/utils/format'
import { normalizeVendorDb } from '../../utils/vendorNormalize'
import { normalizePackageDb } from '../../utils/packageNormalize'
import { normalizeChipCategory } from '../../utils/chipCategory'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: '无效的芯片 ID' })
  }

  const existing = db.prepare('SELECT * FROM chips WHERE id = ?').get(id) as any
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: '芯片不存在' })
  }

  const body = await readBody(event)

  // 如果修改了 UID，检查唯一性（"/" 表示无 UID，跳过唯一性检查）
  if (body.uid) {
    const normUid = normalizeUid(String(body.uid))
    if (!isNoUid(normUid) && normUid !== existing.uid) {
      const conflict = db.prepare('SELECT id FROM chips WHERE uid = ? AND id != ?').get(normUid, id)
      if (conflict) {
        throw createError({ statusCode: 409, statusMessage: `UID "${normUid}" 已存在` })
      }
    }
  }

  // 库位唯一性检查（三字段都非空时，排除自身）
  const finalLa = body.location_a !== undefined
    ? (body.location_a ? String(body.location_a).trim() : null)
    : existing.location_a
  const finalLb = body.location_b !== undefined
    ? (body.location_b ? String(body.location_b).trim() : null)
    : existing.location_b
  const finalLc = body.location_c !== undefined
    ? (body.location_c ? String(body.location_c).trim() : null)
    : existing.location_c
  if (finalLa && finalLb && finalLc) {
    const locDup = db.prepare(
      'SELECT id FROM chips WHERE location_a = ? AND location_b = ? AND location_c = ? AND id != ?'
    ).get(finalLa, finalLb, finalLc, id)
    if (locDup) {
      throw createError({ statusCode: 409, statusMessage: `库位 "${finalLa}-${finalLb}-${finalLc}" 已被占用` })
    }
  }

  // 类型变更：「其他」类型不保留 JEDEC ID / 容量
  if (body.chip_type !== undefined && !['flash', 'mcu', 'other'].includes(String(body.chip_type))) {
    throw createError({ statusCode: 400, statusMessage: '无效的芯片类型' })
  }
  const isOther = body.chip_type === 'other'
  if (isOther) {
    body.jedec_id = ''
    body.capacity = null
  }

  // 芯片类型（仅「其他」使用）：类型或类型字段有提交时校验，避免只改备注的历史数据被拦截
  const finalType = body.chip_type !== undefined ? String(body.chip_type) : String(existing.chip_type)
  if (body.chip_type !== undefined || body.chip_category !== undefined) {
    if (finalType === 'other') {
      const raw = body.chip_category !== undefined ? body.chip_category : existing.chip_category
      const category = normalizeChipCategory(raw)
      if (!category) {
        throw createError({ statusCode: 400, statusMessage: '「其他」类型必须选择芯片类型' })
      }
      body.chip_category = category
    } else {
      // Flash / MCU 不使用该字段，统一置空
      body.chip_category = null
    }
  }

  // 单包颗数：仅「其他」类型 + 无 UID 才允许 > 1，其余一律强制 1
  // （含把类型从 other 改成 flash/mcu、或给 other 芯片补填 UID 的情况，自动回落成 1）
  const uidForQty = body.uid !== undefined ? String(body.uid ?? '') : String(existing.uid ?? '')
  const normUidForQty = normalizeUid(uidForQty)
  const hasUidForQty = !!normUidForQty && !isNoUid(normUidForQty)
  let qty = 1
  if (finalType === 'other' && !hasUidForQty) {
    const raw = body.qty_per_bag !== undefined ? body.qty_per_bag : existing.qty_per_bag
    const n = Number(raw)
    if (raw === null || raw === undefined || raw === '' || !Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
      qty = 1
    } else {
      qty = n
    }
  }
  // 只有值真的变了才写进 body，避免每次编辑都在操作日志里多一条「修改字段: qty_per_bag」
  if (qty !== (existing.qty_per_bag ?? 1)) {
    body.qty_per_bag = qty
  } else {
    delete body.qty_per_bag
  }

  // NOT NULL 字段：空值视为"不想改"，跳过更新，保留数据库原值
  const notNullFields = new Set(['model', 'jedec_id', 'uid'])
  // 库位三级：前端意外清空常见 —— 原值非空 + 新值为空 → 跳过
  const locationFields = new Set(['location_a', 'location_b', 'location_c'])

  // 构建更新字段
  const fields: string[] = []
  const params: any[] = []
  const allowedFields = ['vendor', 'model', 'chip_type', 'jedec_id', 'uid', 'uid_length', 'capacity', 'package', 'chip_category',
    'qty_per_bag',
    'location_a', 'location_b', 'location_c',
    'sec1_locked', 'sec2_locked', 'sec3_locked', 'sec1_data', 'sec2_data', 'sec3_data', 'note']

  // 最终生效的 UID：用于判断 uid_length 是否应置 0（"/" 表示无 UID）
  const finalUid = body.uid !== undefined ? normalizeUid(String(body.uid)) : String(existing.uid ?? '')

  for (const field of allowedFields) {
    if (body[field] === undefined) continue

    // NOT NULL 字段：空字符串或 null → 跳过，不覆盖已有值
    if (notNullFields.has(field)) {
      if (body[field] === null || body[field] === '') {
        // 「其他」类型允许清空 JEDEC ID
        if (field === 'jedec_id' && isOther) {
          fields.push(`${field} = ?`)
          params.push('')
        }
        continue
      }
      // UID 填 "/" 表示无 UID：库存 NULL（uid 列有 UNIQUE 约束，多个 "/" 会冲突，NULL 不冲突）
      if (field === 'uid' && isNoUid(String(body[field]))) {
        fields.push('uid = ?')
        params.push(null)
        continue
      }
      fields.push(`${field} = ?`)
      params.push(field === 'uid' ? normalizeUid(String(body[field])) : body[field])
      continue
    }

    // UID 为 "/" 时 uid_length 强制为 0
    if (field === 'uid_length' && isNoUid(finalUid)) {
      fields.push('uid_length = ?')
      params.push(0)
      continue
    }

    // 单包颗数：服务端已算出最终值，直接写整数，不做「空串 → null」转换
    if (field === 'qty_per_bag') {
      fields.push('qty_per_bag = ?')
      params.push(qty)
      continue
    }

    let val = body[field] === '' ? null : body[field]
    if (val !== null && locationFields.has(field)) {
      val = String(val).trim() || null
    }
    // 厂商名标准化：大小写/中英文别名 → 规范名（内置表+手动品牌表）
    if (field === 'vendor' && val !== null) {
      val = normalizeVendorDb(String(val)) || null
    }
    // 封装标准化：同厂商模式（内置表+手动封装表）
    if (field === 'package' && val !== null) {
      val = normalizePackageDb(String(val)) || null
    }

    // 库位保护：原值非空，新值为空 → 跳过（前端编辑弹窗意外清空常见）
    if (locationFields.has(field) && val === null) {
      if (existing[field] !== null && existing[field] !== '') continue
    }

    fields.push(`${field} = ?`)
    params.push(val)
  }

  fields.push(`updated_at = datetime('now')`)
  params.push(id)

  db.prepare(`UPDATE chips SET ${fields.join(', ')} WHERE id = ?`).run(...params)

  // 插入操作日志
  if (body.note !== undefined) {
    db.prepare('INSERT INTO operation_logs (chip_id, operation, detail) VALUES (?, ?, ?)')
      .run(id, 'update_note', `修改备注: ${body.note}`)
  }
  const otherFields = Object.keys(body).filter(k => k !== 'note')
  if (otherFields.length) {
    db.prepare('INSERT INTO operation_logs (chip_id, operation, detail) VALUES (?, ?, ?)')
      .run(id, 'update', `修改字段: ${otherFields.join(', ')}`)
  }

  return db.prepare('SELECT * FROM chips WHERE id = ?').get(id)
})
