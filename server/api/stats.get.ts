import { db } from '../database/init'

export default defineEventHandler(() => {
  const total = (db.prepare('SELECT COUNT(*) as count FROM chips').get() as any)?.count ?? 0

  const modelStats = db.prepare('SELECT model, chip_type, COUNT(*) as count FROM chips GROUP BY model, chip_type').all()

  const flashCount = (db.prepare("SELECT COUNT(*) as count FROM chips WHERE chip_type = 'flash'").get() as any)?.count ?? 0
  const mcuCount = (db.prepare("SELECT COUNT(*) as count FROM chips WHERE chip_type = 'mcu'").get() as any)?.count ?? 0

  return { total, models: modelStats, by_type: { flash: flashCount, mcu: mcuCount } }
})
