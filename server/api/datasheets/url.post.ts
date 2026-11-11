import { db } from '../../database/init'
import { DS_MAX_SIZE, dsUpsertVersion } from '../../utils/datasheet'

/**
 * URL 直取入库：POST { model, url, version? }
 * 服务器抓取厂商 DS 链接（http 302 跳转自动跟随），校验是 PDF 后存为该型号新版本。
 * 免去"手动下载→选文件→上传"的流程。链接需直指 PDF 文件（或最终响应为 PDF）。
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ model?: string, url?: string, version?: string }>(event).catch(() => ({}))
  const model = String(body?.model || '').trim()
  const url = String(body?.url || '').trim()
  // 版本号归一：v 前缀统一大写
  const version = String(body?.version || '').trim().replace(/^v/, 'V') || null

  if (!model) {
    throw createError({ statusCode: 400, statusMessage: '型号必填' })
  }
  if (!/^https?:\/\//i.test(url)) {
    throw createError({ statusCode: 400, statusMessage: 'URL 必须是 http(s) 链接' })
  }

  let resp: Response
  try {
    resp = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(60_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (flash-mgmt DS fetcher)' },
    })
  } catch (err: any) {
    throw createError({ statusCode: 502, statusMessage: `下载失败: ${err?.message || err}` })
  }
  if (!resp.ok) {
    throw createError({ statusCode: 502, statusMessage: `下载失败: HTTP ${resp.status}` })
  }

  const buf = new Uint8Array(await resp.arrayBuffer())
  if (buf.length === 0) {
    throw createError({ statusCode: 502, statusMessage: '下载内容为空' })
  }
  if (buf.length > DS_MAX_SIZE) {
    throw createError({ statusCode: 400, statusMessage: '文件不能超过 50MB' })
  }
  // PDF 校验：魔数 %PDF 优先，content-type 兜底（部分厂商站 content-type 不规范）
  const isPdfMagic = buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46
  const ct = String(resp.headers.get('content-type') || '')
  if (!isPdfMagic && !ct.toLowerCase().includes('pdf')) {
    throw createError({ statusCode: 400, statusMessage: `返回内容不是 PDF（content-type: ${ct || '未知'}），请确认链接直指文件` })
  }

  // 文件名：Content-Disposition 优先，其次 URL 路径尾段
  let name = ''
  const cd = String(resp.headers.get('content-disposition') || '')
  const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)
  if (m) {
    try { name = decodeURIComponent(m[1].trim()) } catch { name = m[1].trim() }
  }
  if (!name) {
    try { name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '') } catch { /* 忽略 */ }
  }
  name = (name || `${model}.pdf`).trim()
  if (!name.toLowerCase().endsWith('.pdf')) name += '.pdf'

  return dsUpsertVersion(db, model, version, name, buf)
})
