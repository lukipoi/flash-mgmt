import { db } from '../database/init'

export default defineEventHandler(() => {
  const total = (db.prepare('SELECT COUNT(*) as count FROM chips').get() as any)?.count ?? 0

  const modelStats = db.prepare('SELECT model, COUNT(*) as count FROM chips GROUP BY model').all()

  return { total, models: modelStats }
})
