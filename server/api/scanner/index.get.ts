/**
 * GET /api/scanner —— 列出本机 WIA 扫描仪
 */
export default defineEventHandler(async () => {
  try {
    const res = await runScanOnce(['--list'], 15_000)
    if (!res.ok) throw new Error(res.error || '枚举失败')
    return { scanners: res.scanners || [] }
  } catch (err: any) {
    throw createError({ statusCode: 500, statusMessage: err?.message || '枚举扫描仪失败' })
  }
})
