import { db } from '../../database/init'
import { DS_MAX_SIZE, dsUpsertVersion } from '../../utils/datasheet'

/**
 * 上传 Datasheet 新版本（版本管理：每型号一份，重传 = 追加版本并切为当前，不覆盖旧档）
 * multipart 表单：model（必填）、file（必填 pdf ≤50MB）、version（可选版本号标注，如 v3.9）
 */
export default defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event)
  if (!parts) {
    throw createError({ statusCode: 400, statusMessage: '需要 multipart 表单' })
  }

  const model = (parts.find(p => p.name === 'model')?.data.toString('utf-8') ?? '').trim()
  // 版本号归一：v 前缀统一大写（v1.8 → V1.8）
  const version = (parts.find(p => p.name === 'version')?.data.toString('utf-8') ?? '').trim().replace(/^v/, 'V') || null
  const filePart = parts.find(p => p.name === 'file' && p.filename)
  if (!model) {
    throw createError({ statusCode: 400, statusMessage: '型号必填' })
  }
  if (!filePart) {
    throw createError({ statusCode: 400, statusMessage: '缺少 PDF 文件' })
  }
  const ext = (filePart.filename || '').split('.').pop()?.toLowerCase() || ''
  if (ext !== 'pdf') {
    throw createError({ statusCode: 400, statusMessage: '仅支持 PDF 格式' })
  }
  if (filePart.data.length > DS_MAX_SIZE) {
    throw createError({ statusCode: 400, statusMessage: '文件不能超过 50MB' })
  }

  return dsUpsertVersion(db, model, version, filePart.filename || null, filePart.data)
})
