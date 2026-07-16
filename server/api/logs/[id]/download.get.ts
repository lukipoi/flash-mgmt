import { createReadStream } from 'node:fs'
import { statSync } from 'node:fs'
import { db } from '../../../database/init'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: '无效的操作记录 ID' })
  }

  const log = db.prepare('SELECT file_path FROM operation_logs WHERE id = ?').get(id) as { file_path: string } | undefined
  if (!log || !log.file_path) {
    throw createError({ statusCode: 404, statusMessage: '文件不存在' })
  }

  try {
    const stat = statSync(log.file_path)
    if (!stat.isFile()) {
      throw createError({ statusCode: 404, statusMessage: '文件不存在' })
    }
  } catch {
    throw createError({ statusCode: 404, statusMessage: '文件不存在' })
  }

  const fileName = log.file_path.split(/[\\/]/).pop()
  setHeader(event, 'Content-Disposition', `attachment; filename="${fileName}"`)
  return sendStream(event, createReadStream(log.file_path))
})
