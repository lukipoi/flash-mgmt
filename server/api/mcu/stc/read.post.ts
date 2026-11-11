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
import { getLinkEMode, switchLinkEMode } from '../../../utils/wlinkMode'

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

  const pushLog = logId ? (line: string) => logs.get(logId)?.lines.push(line) : undefined

  // ---- 模式保险（与 CH32V/GD32 通道同款，方向相反）：autoCycle 走 wlink 软件控 3V3，
  //      需要 LinkE 处于 RV 模式；当天 ARM SWD 会话后常忘切回，自动切回 RV ----
  if (body?.autoCycle) {
    try {
      const mode = await getLinkEMode()
      if (mode === 'dap') {
        pushLog?.('[WARN] 检测到 LinkE 处于 DAP 模式（上次 ARM SWD 会话忘切回），自动切换 RV...')
        const ok = await switchLinkEMode('rv', wlinkExePath(), pushLog)
        if (!ok) {
          const err = 'LinkE 自动切回 RV 模式失败，请用 WCH-LinkUtility 手动切换后重试'
          pushLog?.(`[ERR] ${err}`)
          if (logId) {
            const e = logs.get(logId)
            if (e) { e.done = true; e.ok = false; e.result = { error: err } }
          }
          throw createError({ statusCode: 409, statusMessage: err })
        }
        // 切模式会让 LinkE 的 CDC 串口重枚举，COM 号常变——自动重找，免得用旧口白跑一趟
        let newPort = ''
        try {
          const enumRes = await runPythonScript(pythonScriptPath('stc_read.py'), ['--ports'], 15_000)
          const plist: { device: string, description: string }[] = enumRes?.ports || []
          const wch = plist.find(p => /wch-link/i.test(p.description || ''))
          if (wch) newPort = wch.device
        } catch { /* 枚举失败不致命，沿用旧口试一次 */ }
        if (newPort && newPort !== port) {
          const idx = args.indexOf('--port')
          if (idx >= 0) args[idx + 1] = newPort
          pushLog?.(`[INFO] 已切回 RV 模式；LinkE 串口已变更为 ${newPort}，本次自动使用`)
        } else if (newPort) {
          pushLog?.('[INFO] 已切回 RV 模式；串口号未变')
        } else {
          pushLog?.('[WARN] 已切回 RV 模式，但未枚举到 WCH-Link 串口——沿用原口，失败请重新选口')
        }
      } else if (mode === 'unknown') {
        pushLog?.('[WARN] 未检测到 WCH-LinkE（自动断电重启需要 LinkE；若用独立 USB-TTL 可忽略）')
      } else {
        pushLog?.('[INFO] LinkE 模式检查通过（RV）')
      }
    } catch (err: any) {
      if (err?.statusCode === 409) throw err
      pushLog?.(`[WARN] 模式检查跳过: ${err?.message || '未知'}`)
    }
  }

  try {
    const res = await runPythonScript(
      pythonScriptPath('stc_read.py'),
      args,
      120_000,
      pushLog,
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
