import { join } from 'node:path'
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { db } from '../database/init'

/**
 * 芯片原件照片：一颗芯片一张，文件存 data/chip-photos/chip-<id>.jpg，
 * chips.photo 列存文件名（NULL = 没照片）。旧芯片不强制补扫。
 * 图像以 dataURL（image/jpeg）从前端传来（扫描预览确认后绑定）。
 */

export const CHIP_PHOTO_DIR = join(process.cwd(), 'data', 'chip-photos')

export function chipPhotoFile(id: number): string {
  return join(CHIP_PHOTO_DIR, `chip-${id}.jpg`)
}

/** 确保目录存在 */
export function ensurePhotoDir(): void {
  mkdirSync(CHIP_PHOTO_DIR, { recursive: true })
}

/** dataURL → 落盘 + 更新 chips.photo；返回文件名字段值。非法 dataURL 抛 400 */
export function saveChipPhoto(db: DatabaseSync, id: number, dataUrl: string): string {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || '').trim())
  if (!m) {
    throw createError({ statusCode: 400, statusMessage: '照片数据必须是 image/jpeg 的 dataURL' })
  }
  const buf = Buffer.from(m[1], 'base64')
  if (buf.length < 1000 || buf.length > 20 * 1024 * 1024) {
    throw createError({ statusCode: 400, statusMessage: `照片大小异常（${buf.length} 字节）` })
  }
  // JPEG 魔数校验（FF D8 FF）
  if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
    throw createError({ statusCode: 400, statusMessage: '照片不是有效的 JPEG 数据' })
  }
  ensurePhotoDir()
  const name = `chip-${id}.jpg`
  writeFileSync(chipPhotoFile(id), buf)
  db.prepare('UPDATE chips SET photo = ?, updated_at = datetime(\'now\') WHERE id = ?').run(name, id)
  return name
}

/** 删除照片文件 + 清列（文件不存在也清列） */
export function removeChipPhoto(db: DatabaseSync, id: number): void {
  try {
    rmSync(chipPhotoFile(id), { force: true })
  } catch { /* 忽略 */ }
  db.prepare('UPDATE chips SET photo = NULL, updated_at = datetime(\'now\') WHERE id = ?').run(id)
}

/** 读照片文件（不存在返回 null） */
export function readChipPhoto(db: DatabaseSync, id: number): Buffer | null {
  const row = db.prepare('SELECT photo FROM chips WHERE id = ?').get(id) as { photo: string | null } | undefined
  if (!row?.photo) return null
  const file = chipPhotoFile(id)
  if (!existsSync(file)) return null
  return readFileSync(file)
}
