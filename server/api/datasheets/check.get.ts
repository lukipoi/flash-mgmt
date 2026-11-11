import { db } from '../../database/init'
import { dsFindForModel } from '../../utils/datasheet'

/**
 * 按型号查 Datasheet：?model=GD25Q64ESIGR
 * 精确命中优先，其次适用型号规则（前缀通配，如 STC8H*）。
 * 有 → 返回元数据对象；无 → 返回 null（前端据此提示「已有 DS 无需上传」或显示上传按钮）
 */
export default defineEventHandler((event) => {
  const model = (getQuery(event).model as string || '').trim()
  if (!model) return null
  return dsFindForModel(db, model) ?? null
})
