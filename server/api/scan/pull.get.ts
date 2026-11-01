/** 电脑端拉取手机推送的条码（取走即清空） */

import { getOrCreateBox, scanPairKey } from '../../utils/scanPair'

export default defineEventHandler(async (event) => {
  const { pair } = getQuery(event)
  if (!pair || typeof pair !== 'string') {
    throw createError({ statusCode: 400, statusMessage: '缺少 pair' })
  }
  const box = await getOrCreateBox(pair)
  const texts = box.queue.splice(0)
  await useStorage('memory').setItem(scanPairKey(pair), box)
  return { texts }
})
