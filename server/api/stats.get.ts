import { db } from '../database/init'

export default defineEventHandler(() => {
  const total = (db.prepare('SELECT COUNT(*) as count FROM chips').get() as any)?.count ?? 0

  const modelStats = db.prepare('SELECT model, chip_type, COUNT(*) as count FROM chips GROUP BY model, chip_type').all()

  const flashCount = (db.prepare("SELECT COUNT(*) as count FROM chips WHERE chip_type = 'flash'").get() as any)?.count ?? 0
  const mcuCount = (db.prepare("SELECT COUNT(*) as count FROM chips WHERE chip_type = 'mcu'").get() as any)?.count ?? 0

  // 设备总数（表可能不存在，try 包裹）
  let equipmentTotal = 0
  try {
    equipmentTotal = (db.prepare('SELECT COUNT(*) as count FROM equipment').get() as any)?.count ?? 0
  } catch {
    // 表还没创建，忽略
  }

  // 耗材总数
  let consumablesTotal = 0
  try {
    consumablesTotal = (db.prepare('SELECT COUNT(*) as count FROM consumables').get() as any)?.count ?? 0
  } catch {
    // 表还没创建，忽略
  }

  // 电路板总数
  let boardsTotal = 0
  try {
    boardsTotal = (db.prepare('SELECT COUNT(*) as count FROM circuit_boards').get() as any)?.count ?? 0
  } catch {
    // 表还没创建，忽略
  }

  return {
    total,
    models: modelStats,
    by_type: { flash: flashCount, mcu: mcuCount },
    equipment_total: equipmentTotal,
    consumables_total: consumablesTotal,
    boards_total: boardsTotal
  }
})
