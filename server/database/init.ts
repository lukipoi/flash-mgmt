import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const DB_PATH = join(process.cwd(), 'data', 'flash.db')

// 全局单例
const globalForDb = globalThis as unknown as { __sqliteDb?: DatabaseSync }

function createDb(): DatabaseSync {
  const dir = dirname(DB_PATH)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const db = new DatabaseSync(DB_PATH)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

const db = globalForDb.__sqliteDb ?? createDb()
if (!globalForDb.__sqliteDb) {
  globalForDb.__sqliteDb = db
}

export { db }

// 初始化表
db.exec(`
  CREATE TABLE IF NOT EXISTS chips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model TEXT NOT NULL,
    jedec_id TEXT NOT NULL,
    uid TEXT NOT NULL UNIQUE,
    uid_length INTEGER DEFAULT 8,
    capacity TEXT,
    page_size INTEGER DEFAULT 256,
    sec1_locked INTEGER DEFAULT 0,
    sec2_locked INTEGER DEFAULT 0,
    sec3_locked INTEGER DEFAULT 0,
    sec1_data TEXT,
    sec2_data TEXT,
    sec3_data TEXT,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_chips_model ON chips(model);
  CREATE INDEX IF NOT EXISTS idx_chips_jedec ON chips(jedec_id);
  CREATE INDEX IF NOT EXISTS idx_chips_uid ON chips(uid);
  CREATE TABLE IF NOT EXISTS operation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chip_id INTEGER NOT NULL,
    operation TEXT NOT NULL,
    detail TEXT,
    file_path TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (chip_id) REFERENCES chips(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_logs_chip_id ON operation_logs(chip_id);
`)

// 迁移：如果 operation_logs 没有 file_path 列则添加
try {
  db.exec(`ALTER TABLE operation_logs ADD COLUMN file_path TEXT`)
} catch {
  // 列已存在，忽略错误
}

// 迁移：chips 表添加 chip_type 列
try {
  db.exec(`ALTER TABLE chips ADD COLUMN chip_type TEXT NOT NULL DEFAULT 'flash'`)
} catch {
  // 列已存在，忽略错误
}

// 迁移：添加 chip_type 索引
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chips_type ON chips(chip_type)`)
} catch {
  // 忽略
}

// ── 设备表 ──────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS equipment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand TEXT,
    model TEXT NOT NULL,
    serial_number TEXT,
    status TEXT NOT NULL DEFAULT 'normal',
    note TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_equipment_brand ON equipment(brand);
  CREATE INDEX IF NOT EXISTS idx_equipment_model ON equipment(model);
  CREATE INDEX IF NOT EXISTS idx_equipment_serial ON equipment(serial_number);
  CREATE INDEX IF NOT EXISTS idx_equipment_status ON equipment(status);
`)

// 迁移：equipment 表加 brand 列
try {
  db.exec(`ALTER TABLE equipment ADD COLUMN brand TEXT`)
} catch { /* 列已存在，忽略 */ }

// 迁移：equipment 表加 status 列
try {
  db.exec(`ALTER TABLE equipment ADD COLUMN status TEXT NOT NULL DEFAULT 'normal'`)
} catch { /* 列已存在，忽略 */ }

// 迁移：归一化 UID 和 JEDEC ID（去空格、转大写）
// 旧数据格式: "AB CD EF 12 34 56 78 90" → 新格式: "ABCDEF1234567890"
// 旧数据格式: "85 60 14" → 新格式: "856014"
try {
  db.exec(`
    UPDATE chips SET
      uid = UPPER(REPLACE(REPLACE(uid, ' ', ''), char(9), '')),
      jedec_id = UPPER(REPLACE(REPLACE(jedec_id, ' ', ''), char(9), ''))
  `)
} catch {
  // 忽略
}

try {
  db.exec(`ALTER TABLE chips ADD COLUMN vendor TEXT`)
} catch { /* 列已存在，忽略 */ }

// 迁移：chips 表加库位三级（大箱 / 小箱 / 序号）
try { db.exec(`ALTER TABLE chips ADD COLUMN location_a TEXT`) } catch { /* 忽略 */ }
try { db.exec(`ALTER TABLE chips ADD COLUMN location_b TEXT`) } catch { /* 忽略 */ }
try { db.exec(`ALTER TABLE chips ADD COLUMN location_c TEXT`) } catch { /* 忽略 */ }

// 库位唯一性（仅三字段都非空时强制；SQLite 中 NULL 不参与 UNIQUE）
try {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_chips_location_unique
    ON chips(location_a, location_b, location_c)
    WHERE location_a IS NOT NULL AND location_b IS NOT NULL AND location_c IS NOT NULL`)
} catch { /* 忽略 */ }

// ── 耗材表 ──────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS consumables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand TEXT,
    model TEXT NOT NULL,
    serial_number TEXT,
    status TEXT NOT NULL DEFAULT 'in_stock',
    note TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_consumables_brand ON consumables(brand);
  CREATE INDEX IF NOT EXISTS idx_consumables_model ON consumables(model);
  CREATE INDEX IF NOT EXISTS idx_consumables_serial ON consumables(serial_number);
  CREATE INDEX IF NOT EXISTS idx_consumables_status ON consumables(status);
`)

// 迁移：旧耗材状态（normal/damaged/lost）→ 新两态（in_use/in_stock）
// 旧 normal → in_stock（储备中），其余也归为 in_stock（暂时没有损坏/丢失概念）
try {
  db.exec(`
    UPDATE consumables SET status = 'in_stock'
    WHERE status IN ('normal', 'damaged', 'lost')
  `)
} catch { /* 表还没创建或无数据，忽略 */ }

// 耗材表：添加商品条码列（可选）
try {
  db.exec(`ALTER TABLE consumables ADD COLUMN barcode TEXT`)
} catch { /* 列已存在，忽略 */ }

// 耗材表：添加保质期 / 执行标准 / 净含量列（可选，针对带保质期品类）
try { db.exec(`ALTER TABLE consumables ADD COLUMN shelf_life TEXT`) } catch { /* 忽略 */ }
try { db.exec(`ALTER TABLE consumables ADD COLUMN production_date TEXT`) } catch { /* 忽略 */ }
try { db.exec(`ALTER TABLE consumables ADD COLUMN exec_standard TEXT`) } catch { /* 忽略 */ }
try { db.exec(`ALTER TABLE consumables ADD COLUMN net_content TEXT`) } catch { /* 忽略 */ }

// 迁移：consumables 表加库位三级（大箱 / 小箱 / 序号）
try { db.exec(`ALTER TABLE consumables ADD COLUMN location_a TEXT`) } catch { /* 忽略 */ }
try { db.exec(`ALTER TABLE consumables ADD COLUMN location_b TEXT`) } catch { /* 忽略 */ }
try { db.exec(`ALTER TABLE consumables ADD COLUMN location_c TEXT`) } catch { /* 忽略 */ }

// 库位唯一性（仅三字段都非空时强制）
try {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_consumables_location_unique
    ON consumables(location_a, location_b, location_c)
    WHERE location_a IS NOT NULL AND location_b IS NOT NULL AND location_c IS NOT NULL`)
} catch { /* 忽略 */ }

// ── 电路板表 ──────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS circuit_boards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand TEXT,
    model TEXT NOT NULL,
    serial_number TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    chips TEXT,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_boards_brand ON circuit_boards(brand);
  CREATE INDEX IF NOT EXISTS idx_boards_model ON circuit_boards(model);
  CREATE INDEX IF NOT EXISTS idx_boards_serial ON circuit_boards(serial_number);
  CREATE INDEX IF NOT EXISTS idx_boards_status ON circuit_boards(status);
`)
