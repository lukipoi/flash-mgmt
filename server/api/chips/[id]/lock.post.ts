import { db } from '../../../database/init'

/**
 * 锁定 OTP（安全区域）
 * body: { sec1?: boolean, sec2?: boolean, sec3?: boolean }
 */
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: '无效的芯片 ID' })
  }

  const chip = db.prepare('SELECT id, model, sec1_locked, sec2_locked, sec3_locked FROM chips WHERE id = ?').get(id) as any
  if (!chip) {
    throw createError({ statusCode: 404, statusMessage: '芯片不存在' })
  }

  const body = await readBody<{ sec1?: boolean; sec2?: boolean; sec3?: boolean }>(event)

  const updates: string[] = []
  const params: any[] = []
  const locked: string[] = []

  if (typeof body.sec1 === 'boolean') {
    updates.push('sec1_locked = ?')
    params.push(body.sec1 ? 1 : 0)
    if (body.sec1) locked.push('SEC1')
  }
  if (typeof body.sec2 === 'boolean') {
    updates.push('sec2_locked = ?')
    params.push(body.sec2 ? 1 : 0)
    if (body.sec2) locked.push('SEC2')
  }
  if (typeof body.sec3 === 'boolean') {
    updates.push('sec3_locked = ?')
    params.push(body.sec3 ? 1 : 0)
    if (body.sec3) locked.push('SEC3')
  }

  if (updates.length === 0) {
    throw createError({ statusCode: 400, statusMessage: '未指定要锁定的 SEC 区域' })
  }

  updates.push('updated_at = datetime(\'now\')')
  params.push(id)

  const sql = `UPDATE chips SET ${updates.join(', ')} WHERE id = ?`
  db.prepare(sql).run(...params)

  const detail = locked.length
    ? `锁定 OTP: ${locked.join(', ')}`
    : '解除 OTP 锁定'

  db.prepare('INSERT INTO operation_logs (chip_id, operation, detail) VALUES (?, ?, ?)')
    .run(id, 'lock_otp', detail)

  return { success: true }
})
