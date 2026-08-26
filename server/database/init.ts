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
