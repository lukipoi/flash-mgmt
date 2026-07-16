import { db } from '../database/init'

/**
 * 自动档案识别接口
 * 根据读取到的 JEDEC ID 和 UID 匹配数据库中的芯片
 * 优先按 UID 精确匹配，匹配不到再按 JEDEC ID + UID 长度匹配
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{
    jedec_id?: string
    uid?: string
    uid_length?: number
  }>(event)

  const jedecId = (body.jedec_id || '').trim()
  const uid = (body.uid || '').trim()
  const uidLength = body.uid_length

  if (!jedecId && !uid) {
    throw createError({
      statusCode: 400,
      statusMessage: '缺少识别参数: jedec_id 和 uid 至少需要一个'
    })
  }

  // 1) 按 UID 精确匹配（最可靠，每颗芯片唯一）
  if (uid) {
    const byUid = db.prepare('SELECT * FROM chips WHERE uid = ?').get(uid) as any
    if (byUid) {
      // 记录一次识别成功的日志
      db.prepare(`
        INSERT INTO operation_logs (chip_id, operation, detail)
        VALUES (?, 'identify', ?)
      `).run(byUid.id, `通过 UID 自动识别命中: ${byUid.model}`)
      return {
        matched: true,
        match_by: 'uid',
        chip: byUid
      }
    }
  }

  // 2) 按 JEDEC ID + UID 长度模糊匹配（提示可能的新芯片）
  if (jedecId) {
    const conditions: string[] = ['jedec_id = ?']
    const params: any[] = [jedecId]
    if (uidLength) {
      conditions.push('uid_length = ?')
      params.push(uidLength)
    }
    const candidates = db.prepare(`
      SELECT id, model, jedec_id, uid, uid_length, capacity, created_at
      FROM chips
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT 10
    `).all(...params)

    if (candidates.length > 0) {
      return {
        matched: false,
        match_by: 'jedec_id',
        reason: 'JEDEC ID 匹配但 UID 不在档案中，可能是一颗未登记的同型号新芯片',
        candidates
      }
    }
  }

  // 3) 完全未匹配
  return {
    matched: false,
    match_by: null,
    reason: '档案中未找到此芯片，需要创建新档案',
    candidates: []
  }
})
