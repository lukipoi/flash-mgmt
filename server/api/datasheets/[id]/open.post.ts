import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { db } from '../../../database/init'
import { dsCurrentFilePath, dsVersionFilePath } from '../../../utils/datasheet'

/**
 * 用系统默认 PDF 程序打开 DS 文件本体（服务器与浏览器同机时有效）。
 * 实现走 explorer.exe <file>：等价于双击文件，由系统文件关联决定程序。
 * 默认打开当前版本文件（回滚后随指针走）；?ver=<verId> 打开指定历史版本。
 */
export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: '无效 ID' })
  }
  const row = db.prepare('SELECT id, current_ver FROM datasheets WHERE id = ?').get(id) as
    | { id: number, current_ver: number | null }
    | undefined
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: '该型号没有 Datasheet' })
  }
  const qver = Number(getQuery(event).ver) || 0
  let path: string
  if (qver) {
    const ver = db.prepare('SELECT id FROM datasheet_versions WHERE id = ? AND ds_id = ?').get(qver, id)
    if (!ver) {
      throw createError({ statusCode: 404, statusMessage: '版本不存在' })
    }
    path = dsVersionFilePath(qver)
  } else {
    path = dsCurrentFilePath(row)
  }
  if (!existsSync(path)) {
    throw createError({ statusCode: 404, statusMessage: 'DS 文件缺失' })
  }
  try {
    spawn('explorer.exe', [path], { detached: true, stdio: 'ignore' }).unref()
  } catch (err: any) {
    throw createError({ statusCode: 500, statusMessage: `调起系统程序失败: ${err?.message || err}` })
  }
  return { ok: true }
})
