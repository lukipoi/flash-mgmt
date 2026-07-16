import { createReadStream, statSync } from 'node:fs'
import { join } from 'node:path'

const DB_PATH = join(process.cwd(), 'data', 'flash.db')

export default defineEventHandler((event) => {
  try {
    const stat = statSync(DB_PATH)
    if (!stat.isFile()) {
      throw createError({ statusCode: 404, statusMessage: '数据库文件不存在' })
    }
  } catch {
    throw createError({ statusCode: 404, statusMessage: '数据库文件不存在' })
  }

  const timestamp = new Date().toISOString().slice(0, 10)
  const fileName = `flash-mgmt-${timestamp}.db`

  setHeader(event, 'Content-Type', 'application/octet-stream')
  setHeader(event, 'Content-Disposition', `attachment; filename="${fileName}"`)
  setHeader(event, 'Content-Length', statSync(DB_PATH).size)

  return sendStream(event, createReadStream(DB_PATH))
})