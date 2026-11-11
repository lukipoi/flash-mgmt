import { join } from 'node:path'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'

/**
 * Datasheet（芯片规格书）共享逻辑：每型号一份，按 model_key（lower+trim）关联。
 * 文件本体存 data/datasheets/<id>.pdf，元数据在 datasheets 表。
 * 同型号所有芯片共享一份 DS，录新芯片零操作自动关联。
 */

export const DS_DIR = join(process.cwd(), 'data', 'datasheets')
export const DS_MAX_SIZE = 50 * 1024 * 1024 // 50MB

export interface DatasheetRow {
  id: number
  model_key: string
  model: string
  original_name: string | null
  size: number | null
  uploaded_at: string
  aliases: string | null
}

/** 型号归一键：去空格 + 小写（GD25Q64 与 gd25q64 视为同一型号） */
export function dsModelKey(model: string): string {
  return model.trim().replace(/\s+/g, '').toLowerCase()
}

export function dsFilePath(id: number): string {
  return join(DS_DIR, `${id}.pdf`)
}

/** 版本存档文件（版本管理：每次上传追加一版，不覆盖） */
export function dsVersionFilePath(verId: number): string {
  return join(DS_DIR, `ver-${verId}.pdf`)
}

/** 当前版本文件路径（current_ver 为空 = 旧版无版本管理的遗留数据，走 legacy 路径） */
export function dsCurrentFilePath(row: { id: number, current_ver?: number | null }): string {
  return row.current_ver ? dsVersionFilePath(row.current_ver) : dsFilePath(row.id)
}

export function dsFindByModel(db: DatabaseSync, model: string): DatasheetRow | undefined {
  return db.prepare('SELECT * FROM datasheets WHERE model_key = ?').get(dsModelKey(model)) as DatasheetRow | undefined
}

// ── 适用型号规则（aliases）──────────────────────────────────
// 规则 = 精确型号 或 前缀通配（STC8H*），逗号/空白分隔；大小写不敏感。

/** 拆分规则串为归一规则数组 */
export function dsParseAliases(aliases: string | null | undefined): string[] {
  return String(aliases || '')
    .split(/[,，;；\s]+/)
    .map(s => dsModelKey(s))
    .filter(Boolean)
}

/** 型号 key 是否命中某 DS 行的规则 */
export function dsMatchAlias(modelKey: string, aliases: string | null | undefined): boolean {
  return dsParseAliases(aliases).some(rule =>
    rule.endsWith('*') ? modelKey.startsWith(rule.slice(0, -1)) : modelKey === rule,
  )
}

/** 按型号找 DS：精确命中优先，其次别名规则（前缀通配） */
export function dsFindForModel(db: DatabaseSync, model: string): DatasheetRow | undefined {
  const exact = dsFindByModel(db, model)
  if (exact) return exact
  const key = dsModelKey(model)
  const rows = db.prepare('SELECT * FROM datasheets WHERE aliases IS NOT NULL').all() as DatasheetRow[]
  return rows.find(r => dsMatchAlias(key, r.aliases))
}

/**
 * 追加一个 DS 版本并切为当前（multipart 上传与 URL 导入共用）。
 * 首次上传自动建行；旧版无版本管理的 legacy 单文件在首次版本化后清理。
 */
export function dsUpsertVersion(
  db: DatabaseSync,
  model: string,
  version: string | null,
  originalName: string | null,
  data: Uint8Array,
): DatasheetRow {
  mkdirSync(DS_DIR, { recursive: true })
  const existing = dsFindByModel(db, model)
  if (existing) {
    const vres = db.prepare('INSERT INTO datasheet_versions (ds_id, version, original_name, size) VALUES (?, ?, ?, ?)')
      .run(existing.id, version, originalName, data.length)
    const verId = Number(vres.lastInsertRowid)
    writeFileSync(dsVersionFilePath(verId), data)
    if (!existing.current_ver) {
      try { rmSync(dsFilePath(existing.id), { force: true }) } catch { /* 清理失败不阻塞 */ }
    }
    db.prepare(`UPDATE datasheets SET model = ?, version = ?, original_name = ?, size = ?,
      uploaded_at = datetime('now'), current_ver = ? WHERE id = ?`)
      .run(model, version, originalName, data.length, verId, existing.id)
    return db.prepare('SELECT * FROM datasheets WHERE id = ?').get(existing.id) as DatasheetRow
  }
  const result = db.prepare('INSERT INTO datasheets (model_key, model, version, original_name, size) VALUES (?, ?, ?, ?, ?)')
    .run(dsModelKey(model), model, version, originalName, data.length)
  const dsId = Number(result.lastInsertRowid)
  const vres = db.prepare('INSERT INTO datasheet_versions (ds_id, version, original_name, size) VALUES (?, ?, ?, ?)')
    .run(dsId, version, originalName, data.length)
  const verId = Number(vres.lastInsertRowid)
  writeFileSync(dsVersionFilePath(verId), data)
  db.prepare('UPDATE datasheets SET current_ver = ? WHERE id = ?').run(verId, dsId)
  return db.prepare('SELECT * FROM datasheets WHERE id = ?').get(dsId) as DatasheetRow
}
