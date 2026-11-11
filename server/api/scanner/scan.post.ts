/**
 * POST /api/scanner/scan —— 触发一次扫描并解码条码/二维码
 *
 * body（可选）：{
 *   dpi?: number,             // 默认 300（标签 QR 模块小，300 比 200 稳）
 *   pixel?: 'gray'|'color'|'bw',
 *   name?: string,            // WIA 设备名关键词（仅 WIA 路径）
 *   mode?: 'tiles'|'full',    // 默认 full（旧行为，正式 UI 不受影响）；tiles 为实验性分块快扫
 *   tiles?: string,           // 分块规格 RxC，默认 2x2
 *   overlap?: number,         // 块间重叠比例 0~0.4，默认 0.12（防码被切块边界切断）
 *   escl?: string,            // eSCL 基址（如 http://192.168.1.208/eSCL），给了就网络直连打印机
 *                             //   （整面流式快扫，建议配 dpi:200；实验开关 LabFeaturesPanel 注入）
 *   region?: string,          // eSCL 固定区域 "fx,fy,fw,fh"（比例）。已实验弃用（分块/区域总行程不赚），保留作隐藏能力
 * }
 * 返回：{ texts: [{ text, format }], elapsedMs, mode, tile, tiles }
 *   mode: wia_tiles / wia_full / escl_tiles / escl_full
 *   tile: 命中的块序号（分块模式才有；null = 整面兜底命中）
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, any>>(event).catch(() => ({}))

  const dpi = Math.min(1200, Math.max(100, Number(body?.dpi) || 300))
  const pixel = ['gray', 'color', 'bw'].includes(body?.pixel) ? body.pixel : 'gray'
  const mode = body?.mode === 'tiles' ? 'tiles' : 'full'
  const args = ['--scan', '--dpi', String(dpi), '--pixel', pixel, '--mode', mode]

  if (typeof body?.name === 'string' && body.name.trim()) {
    args.push('--name', body.name.trim())
  }
  if (typeof body?.escl === 'string' && /^https?:\/\/.+/.test(body.escl.trim())) {
    args.push('--escl', body.escl.trim())
  }
  if (typeof body?.region === 'string' && /^[\d.]+,[\d.]+,[\d.]+,[\d.]+$/.test(body.region.trim())) {
    args.push('--region', body.region.trim())
  }
  if (typeof body?.tiles === 'string' && /^\d+x\d+$/.test(body.tiles.trim())) {
    args.push('--tiles', body.tiles.trim())
  }
  if (body?.overlap !== undefined && Number.isFinite(Number(body.overlap))) {
    const ov = Math.min(0.4, Math.max(0, Number(body.overlap)))
    args.push('--overlap', String(ov))
  }

  try {
    const res = await runScanOnce(args, 120_000)
    if (!res.ok) throw new Error(res.error || '扫描失败')
    return {
      texts: res.texts || [],
      elapsedMs: res.elapsed_ms || 0,
      mode: res.mode || null,
      tile: res.tile ?? null,
      tiles: res.tiles || null,
    }
  } catch (err: any) {
    throw createError({ statusCode: 500, statusMessage: err?.message || '扫描失败' })
  }
})
