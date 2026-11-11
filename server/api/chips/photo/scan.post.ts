/**
 * POST /api/chips/photo/scan —— 扫一张芯片原件照，返回 dataURL 预览
 *
 * body: { escl?: string, name?: string, dpi?: number }
 *  - escl 给了走 eSCL 网络直连（快扫开关开启时前端注入 LAB_DEFAULT_ESCL + 200dpi）
 *  - 没给走 WIA 本机扫描仪
 * 流程：chip_photo.py 整面彩色扫描 → PIL 裁白边 → JPEG 落临时文件 → base64 回传 → 删临时文件。
 * 前端预览确认后把 dataURL POST 到 /api/chips/<id>/photo 或随录入表单提交。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pythonScriptPath, runPythonScript } from '../../../utils/scannerRuntime'

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, any>>(event).catch(() => ({}))
  const escl = String(body?.escl || '').trim()
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!escl && !name && body?.escl !== undefined) {
    throw createError({ statusCode: 400, statusMessage: 'eSCL 基址格式非法' })
  }
  const dpi = Math.min(600, Math.max(100, Number(body?.dpi) || 200))

  const tmpDir = mkdtempSync(join(tmpdir(), 'chip-photo-'))
  const outFile = join(tmpDir, 'photo.jpg')
  try {
    const args = ['--out', outFile, '--dpi', String(dpi)]
    if (escl) args.push('--escl', escl)
    if (name) args.push('--name', name)
    const res = await runPythonScript(
      pythonScriptPath('chip_photo.py'),
      args,
      120_000,
    )
    if (!res.ok) throw new Error(String(res.error || '扫描失败'))
    const buf = readFileSync(outFile)
    return {
      image: `data:image/jpeg;base64,${buf.toString('base64')}`,
      width: res.width ?? null,
      height: res.height ?? null,
      cropped: !!res.cropped,
      elapsedMs: res.elapsed_ms || 0,
    }
  } catch (err: any) {
    throw createError({ statusCode: 500, statusMessage: err?.message || '扫描失败' })
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
})
