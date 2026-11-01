/**
 * POST /api/mcu/stc/read —— 通过 USB-TTL 串口读取 STC 芯片信息
 *
 * body: { port: string, trim?: number, erase?: boolean, autoCycle?: boolean, logId?: string }
 *  - 默认只握手+初始化：拿型号/BSL/时钟/TRIM（stc15/12/8 系列握手包不带 UID）
 *  - erase=true：握手后追加擦除命令，从擦除应答取 UID —— 会毁掉片内程序，仅空片可用！
 *    （UID 位于程序区最后 7 字节，硬件保护，擦除不会毁掉 UID 本身）
 *  - logId：前端生成；传入后 wlink/stcgal 原始日志按行实时存入内存缓冲，
 *    供 GET /api/mcu/stc/log?logId=xxx 轮询展示（跑完自动关日志框用）
 * trim 为 IRC 频率 MHz，默认 22.1184
 */
interface StcLogEntry {
  lines: string[]
  done: boolean
  ok: boolean
  result: Record<string, any> | null
}

const logs = ((globalThis as any).__stcLogs ||= new Map<string, StcLogEntry>())

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, any>>(event).catch(() => ({}))
  const port = String(body?.port || '').trim()
  if (!port) {
    throw createError({ statusCode: 400, statusMessage: '缺少串口号 port' })
  }

  const args = ['--port', port]
  const trim = Number(body?.trim)
  if (trim > 0) args.push('--trim', String(trim))
  if (body?.erase) args.push('--erase-uid')
  // WCH-LinkE 自动断电重启（软件控 3V3，免手动掉电）
  if (body?.autoCycle) args.push('--auto-cycle')

  const logId = String(body?.logId || '')
  if (logId) {
    // 防泄漏：最多留 20 份日志
    while (logs.size >= 20) {
      logs.delete(logs.keys().next().value as string)
    }
    logs.set(logId, { lines: [], done: false, ok: false, result: null })
  }

  try {
    const res = await runPythonScript(
      pythonScriptPath('stc_read.py'),
      args,
      120_000,
      logId ? (line: string) => logs.get(logId)?.lines.push(line) : undefined,
    )
    if (logId) {
      const e = logs.get(logId)
      if (e) { e.done = true; e.ok = true; e.result = res }
    }
    if (!res.ok) throw new Error(String(res.error || '读取失败'))
    return {
      uid: res.uid || '',
      model: res.model || '',
      protocol: res.protocol || '',
      bsl_version: res.bsl_version ?? '',
      magic: res.magic || '',
      clock_hz: res.clock_hz ?? null,
      trim_data: res.trim_data || '',
    }
  } catch (err: any) {
    if (logId) {
      const e = logs.get(logId)
      if (e) { e.done = true; e.ok = false; e.result = { error: err?.message } }
    }
    throw createError({ statusCode: 500, statusMessage: err?.message || '读取失败' })
  }
})
