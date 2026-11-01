/**
 * POST /api/scanner/scan —— 触发一次扫描并解码条码/二维码
 *
 * body（可选）：{ dpi?: number, pixel?: 'gray'|'color'|'bw', name?: string }
 * 默认 300 DPI 灰度（标签 QR 模块小，300 比 EXP-SCAN 面单用的 200 更稳）。
 * 返回：{ texts: [{ text, format }], elapsedMs }
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, any>>(event).catch(() => ({}))

  const dpi = Math.min(1200, Math.max(100, Number(body?.dpi) || 300))
  const pixel = ['gray', 'color', 'bw'].includes(body?.pixel) ? body.pixel : 'gray'
  const args = ['--scan', '--dpi', String(dpi), '--pixel', pixel]
  if (typeof body?.name === 'string' && body.name.trim()) {
    args.push('--name', body.name.trim())
  }

  try {
    const res = await runScanOnce(args, 120_000)
    if (!res.ok) throw new Error(res.error || '扫描失败')
    return { texts: res.texts || [], elapsedMs: res.elapsed_ms || 0 }
  } catch (err: any) {
    throw createError({ statusCode: 500, statusMessage: err?.message || '扫描失败' })
  }
})
