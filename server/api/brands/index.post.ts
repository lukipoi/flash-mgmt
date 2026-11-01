import { db } from '../../database/init'
import { findBrand } from '../../../utils/brands'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const LOGO_EXTS = ['png', 'jpg', 'jpeg', 'svg', 'webp']
const MAX_LOGO_SIZE = 2 * 1024 * 1024

/**
 * 手动添加品牌（用户的 logo 绑定通道）
 * multipart 表单：name（必填规范名）、aliases（可选，逗号分隔别名）、logo（可选 png/svg/jpg/webp，≤2MB）
 */
export default defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event)
  if (!parts) {
    throw createError({ statusCode: 400, statusMessage: '需要 multipart 表单' })
  }

  const name = (parts.find(p => p.name === 'name')?.data.toString('utf-8') ?? '').trim()
  const aliasesRaw = (parts.find(p => p.name === 'aliases')?.data.toString('utf-8') ?? '').trim()
  // 改名场景：手动品牌的原名（编辑时由前端回传），为空表示新增
  const originalName = (parts.find(p => p.name === 'original_name')?.data.toString('utf-8') ?? '').trim()
  const logoPart = parts.find(p => p.name === 'logo' && p.filename)

  if (!name) {
    throw createError({ statusCode: 400, statusMessage: '品牌名必填' })
  }

  const key = name.toLowerCase()
  const builtin = findBrand(name)

  // 新增时的防重检查：改名不算冲突（同一条记录自身）；与其他内置/手动品牌重名仍拒绝
  if (!originalName || originalName.toLowerCase() !== key) {
    if (builtin) {
      // 与内置品牌重名：非新增即覆盖（补 logo/补别名），下面统一走 UPSERT
    }
    else {
      const dup = db.prepare('SELECT id FROM brands WHERE lower(name) = ?').get(key)
      if (dup) {
        throw createError({ statusCode: 409, statusMessage: `品牌 "${name}" 已录入过` })
      }
    }
  }
  // 改名时：新名与其他品牌冲突检查（排除自身）
  if (originalName && originalName.toLowerCase() !== key) {
    if (findBrand(name)) {
      throw createError({ statusCode: 409, statusMessage: `新名称 "${name}" 与内置品牌冲突` })
    }
    const dup = db.prepare('SELECT id FROM brands WHERE lower(name) = ?').get(key) as { id: number } | undefined
    if (dup) {
      throw createError({ statusCode: 409, statusMessage: `新名称 "${name}" 已被其他品牌占用` })
    }
  }

  // 别名规范化：逗号分隔，去空，排除与品牌名相同的
  const aliases = aliasesRaw
    .split(/[,，]/)
    .map(a => a.trim())
    .filter(a => a && a.toLowerCase() !== key)
    .join(',')

  // logo 上传（可选）
  let logoPath: string | null = null
  if (logoPart) {
    const rawName = logoPart.filename || 'logo'
    const ext = rawName.split('.').pop()?.toLowerCase() || ''
    if (!LOGO_EXTS.includes(ext)) {
      throw createError({ statusCode: 400, statusMessage: `logo 仅支持 ${LOGO_EXTS.join('/')} 格式` })
    }
    if (logoPart.data.length > MAX_LOGO_SIZE) {
      throw createError({ statusCode: 400, statusMessage: 'logo 文件不能超过 2MB' })
    }
    const dir = join(process.cwd(), 'public', 'vendors')
    mkdirSync(dir, { recursive: true })
    // 时间戳命名避免中文/特殊字符文件名问题
    const filename = `brand-${Date.now()}.${ext}`
    logoPath = `/vendors/${filename}`
    writeFileSync(join(dir, filename), logoPart.data)
  }

  if (originalName) {
    // 编辑模式：按原名更新手动品牌记录（可改名）
    const existing = db.prepare('SELECT id, logo FROM brands WHERE lower(name) = ?').get(originalName.toLowerCase()) as { id: number, logo: string | null } | undefined
    if (!existing) {
      throw createError({ statusCode: 404, statusMessage: `品牌 "${originalName}" 不存在` })
    }
    // 未上传新 logo 时保留原有
    const finalLogo = logoPath ?? existing.logo
    db.prepare('UPDATE brands SET name = ?, aliases = ?, logo = ? WHERE id = ?')
      .run(name, aliases || null, finalLogo, existing.id)
    // 改名联动：chips.vendor 已按旧规范名归一存储，同步更新避免失配
    if (originalName.toLowerCase() !== key) {
      db.prepare('UPDATE chips SET vendor = ? WHERE lower(vendor) = lower(?)').run(name, originalName)
    }
    return db.prepare('SELECT id, name, aliases, logo, created_at FROM brands WHERE id = ?').get(existing.id)
  }

  // 与内置品牌重名：UPSERT 覆盖（补 logo/补别名）；纯新增走 INSERT
  const existing = db.prepare('SELECT id, logo FROM brands WHERE lower(name) = ?').get(key) as { id: number, logo: string | null } | undefined
  if (existing) {
    const finalLogo = logoPath ?? existing.logo
    db.prepare('UPDATE brands SET name = ?, aliases = ?, logo = ? WHERE id = ?')
      .run(name, aliases || null, finalLogo, existing.id)
    return db.prepare('SELECT id, name, aliases, logo, created_at FROM brands WHERE id = ?').get(existing.id)
  }

  const result = db.prepare('INSERT INTO brands (name, aliases, logo) VALUES (?, ?, ?)').run(name, aliases || null, logoPath)
  return db.prepare('SELECT id, name, aliases, logo, created_at FROM brands WHERE id = ?').get(result.lastInsertRowid)
})
