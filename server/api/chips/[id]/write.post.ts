import { db } from '../../../database/init'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

/**
 * 写入 Flash（上传 bin 文件）
 * 接收 multipart/form-data: file (binary), address? (string, default "0x00")
 */
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: '无效的芯片 ID' })
  }

  const chip = db.prepare('SELECT id, model FROM chips WHERE id = ?').get(id) as any
  if (!chip) {
    throw createError({ statusCode: 404, statusMessage: '芯片不存在' })
  }

  const formData = await readMultipartFormData(event)
  if (!formData) {
    throw createError({ statusCode: 400, statusMessage: '未收到文件数据' })
  }

  const filePart = formData.find(f => f.name === 'file')
  if (!filePart || !filePart.data || filePart.data.length === 0) {
    throw createError({ statusCode: 400, statusMessage: '缺少文件字段' })
  }

  const addressField = formData.find(f => f.name === 'address')
  const address = addressField?.data?.toString() || '0x00'

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const originalName = filePart.filename || 'data.bin'
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_')
  const saveName = `${timestamp}-${safeName}`
  const dir = join(process.cwd(), 'data', 'writes', `chip-${id}`)
  const filePath = join(dir, saveName)

  mkdirSync(dir, { recursive: true })
  writeFileSync(filePath, filePart.data)

  const detail = `写入 Flash: ${originalName} (${filePart.data.length} bytes) @ ${address}`

  db.prepare('INSERT INTO operation_logs (chip_id, operation, detail, file_path) VALUES (?, ?, ?, ?)')
    .run(id, 'write_flash', detail, filePath)

  return {
    success: true,
    saved_as: saveName,
    size: filePart.data.length,
    address
  }
})
