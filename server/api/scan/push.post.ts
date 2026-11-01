/** 手机端推送识别结果 */

import { getOrCreateBox, scanPairKey } from '../../utils/scanPair'

export default defineEventHandler(async (event) => {
  const { pair, text } = await readBody<{ pair?: string; text?: string }>(event) || {}
  const t = String(text || '').trim()
  if (!pair || !t) {
    throw createError({ statusCode: 400, statusMessage: '缺少 pair 或 text' })
  }
  const box = await getOrCreateBox(pair)
  box.queue.push(t)
  await useStorage('memory').setItem(scanPairKey(pair), box)
  return { ok: true }
})
