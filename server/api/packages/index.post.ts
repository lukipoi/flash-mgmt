import { db } from '../../database/init'
import { findPackage } from '../../../utils/packages'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const IMG_EXTS = ['png', 'jpg', 'jpeg', 'svg', 'webp']
const MAX_IMG_SIZE = 2 * 1024 * 1024

/**
 * 新增封装 / 给内置封装补图
 * multipart 表单：name（必填）、aliases（可选，逗号分隔）、image（可选 png/svg/jpg/webp ≤2MB）
 * 与内置封装重名时不报错，而是作为「补图/补别名」覆盖该内置条目
 */
export default defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event)
  if (!parts) {
    throw createError({ statusCode: 400, statusMessage: '需要 multipart 表单' })
  }

  const rawName = (parts.find(p => p.name === 'name')?.data.toString('utf-8') ?? '').trim()
  const aliasesRaw = (parts.find(p => p.name === 'aliases')?.data.toString('utf-8') ?? '').trim()
  const imgPart = parts.find(p => p.name === 'image' && p.filename)

  if (!rawName) {
    throw createError({ statusCode: 400, statusMessage: '封装名必填' })
  }

  // 归一：命中内置用内置规范名；否则用 trim 原文作为手动封装名
  const builtin = findPackage(rawName)
  const name = builtin ? builtin.name : rawName
  const key = name.toLowerCase()

  // 手动封装防重
  const dup = db.prepare('SELECT id, image FROM packages WHERE lower(name) = ?').get(key) as { id: number, image: string | null } | undefined
  if (dup && !imgPart && !aliasesRaw) {
    throw createError({ statusCode: 409, statusMessage: `封装 "${name}" 已录入过` })
  }

  const aliases = aliasesRaw
    .split(/[,，]/)
    .map(a => a.trim())
    .filter(a => a && a.toLowerCase() !== key)
    .join(',')

  let imagePath: string | null = null
  if (imgPart) {
    const rawFile = imgPart.filename || 'image'
    const ext = rawFile.split('.').pop()?.toLowerCase() || ''
    if (!IMG_EXTS.includes(ext)) {
      throw createError({ statusCode: 400, statusMessage: `图片仅支持 ${IMG_EXTS.join('/')} 格式` })
    }
    if (imgPart.data.length > MAX_IMG_SIZE) {
      throw createError({ statusCode: 400, statusMessage: '图片文件不能超过 2MB' })
    }
    const dir = join(process.cwd(), 'public', 'packages')
    mkdirSync(dir, { recursive: true })
    const filename = `pkg-${Date.now()}.${ext}`
    imagePath = `/packages/${filename}`
    writeFileSync(join(dir, filename), imgPart.data)
  }

  if (dup) {
    // 已存在（含内置覆盖条目）→ 只更新提供的字段
    db.prepare('UPDATE packages SET aliases = COALESCE(?, aliases), image = COALESCE(?, image) WHERE id = ?')
      .run(aliases || null, imagePath, dup.id)
    return db.prepare('SELECT id, name, aliases, image, created_at FROM packages WHERE id = ?').get(dup.id)
  }

  const result = db.prepare('INSERT INTO packages (name, aliases, image) VALUES (?, ?, ?)').run(name, aliases || null, imagePath)
  return db.prepare('SELECT id, name, aliases, image, created_at FROM packages WHERE id = ?').get(result.lastInsertRowid)
})
