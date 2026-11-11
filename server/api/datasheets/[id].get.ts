import { db } from '../../database/init'
import { existsSync, statSync, createReadStream } from 'node:fs'
import { dsVersionFilePath, dsFilePath } from '../../utils/datasheet'

/**
 * 查看 / 下载 Datasheet 文件本体（默认当前版本；?ver=<verId> 取历史版本）
 * 默认 inline；?download=1 时以原始文件名下载。
 * Cache-Control 用 no-store：版本可被替换/回滚，同 URL 内容会变，禁止浏览器缓存
 * （否则会出现"替换了但看到的还是旧版"——实测踩过）。
 */
export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: '无效 ID' })
  }
  const row = db.prepare('SELECT * FROM datasheets WHERE id = ?').get(id) as
    | { id: number, model: string, original_name: string | null, current_ver: number | null }
    | undefined
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: '该型号没有 Datasheet' })
  }

  // 指定历史版本（需归属校验），否则当前版本
  const qver = Number(getQuery(event).ver) || 0
  let verId = 0
  if (qver) {
    const ver = db.prepare('SELECT id FROM datasheet_versions WHERE id = ? AND ds_id = ?').get(qver, id)
    if (!ver) {
      throw createError({ statusCode: 404, statusMessage: '版本不存在' })
    }
    verId = qver
  } else {
    verId = row.current_ver || 0
  }
  const path = verId ? dsVersionFilePath(verId) : dsFilePath(row.id)
  if (!existsSync(path)) {
    throw createError({ statusCode: 404, statusMessage: 'DS 文件缺失（数据库有记录但文件不在）' })
  }

  const download = getQuery(event).download === '1'
  const rawName = row.original_name || `${row.model}.pdf`
  const encoded = encodeURIComponent(rawName)
  setHeaders(event, {
    'Content-Type': 'application/pdf',
    'Content-Length': String(statSync(path).size),
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="datasheet-${verId || row.id}.pdf"; filename*=UTF-8''${encoded}`,
    'Cache-Control': 'no-store',
  })
  return sendStream(event, createReadStream(path))
})
