/**
 * POST /api/mcu/apm32/read —— Geehy 极海 APM32 系列 SWD 信息读取
 *
 * body: { logId?: string }
 *  - 传输：pyOCD（WCH-LinkE DAP 模式 = CMSIS-DAP，免驱）
 *  - 识别：CPUID 诊断 + 电子签名区直读（极海官方 UM/DS 均无 DBG_IDCODE/DEV_ID 实锤，
 *    OpenOCD 官方 patch 亦用 CPUID partno 识别 F003，故不走 DEV_ID 家族表）
 *    UID 96bit @0x0002 03E4（UM §20 偏移 + 同型号实测）；F_SIZE u16 @0x0002 03E0（KB）
 *    DBG_IDCODE 候选 0x40015800 仅记录诊断，不做门槛
 *  - 模式保险：LinkE 必须 DAP 模式，读取前自动检测并切换
 *  - logId 复用 __stcLogs（GET /api/mcu/stc/log 轮询端点）
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
  const logId = String(body?.logId || '')
  if (logId) {
    while (logs.size >= 20) {
      logs.delete(logs.keys().next().value as string)
    }
    logs.set(logId, { lines: [], done: false, ok: false, result: null })
  }

  const pushLog = logId ? (line: string) => logs.get(logId)?.lines.push(line) : undefined

  // ---- 模式保险：APM32 走 SWD 需要 LinkE 处于 DAP 模式 ----
  try {
    const mode = await getLinkEMode()
    if (mode === 'rv') {
      pushLog?.('[WARN] 检测到 LinkE 处于 RV 模式（上次 CH32V 会话忘切回），自动切换 DAP...')
      const ok = await switchLinkEMode('dap', wlinkExePath(), pushLog)
      if (!ok) {
        const err = 'LinkE 自动切回 DAP 模式失败，请用 WCH-LinkUtility 手动切换后重试'
        pushLog?.(`[ERR] ${err}`)
        if (logId) {
          const e = logs.get(logId)
          if (e) { e.done = true; e.ok = false; e.result = { error: err } }
        }
        throw createError({ statusCode: 409, statusMessage: err })
      }
    } else if (mode === 'unknown') {
      pushLog?.('[WARN] 未检测到 WCH-LinkE（确认探针已插 USB）')
    } else {
      pushLog?.('[INFO] LinkE 模式检查通过（DAP）')
    }
  } catch (err: any) {
    if (err?.statusCode === 409) throw err
    pushLog?.(`[WARN] 模式检查跳过: ${err?.message || '未知'}`)
  }

  try {
    const res = await runPythonScript(
      pythonScriptPath('apm32_read.py'),
      [],
      60_000,
      pushLog,
    )
    if (logId) {
      const e = logs.get(logId)
      if (e) { e.done = true; e.ok = true; e.result = res }
    }
    if (!res.ok) throw new Error(String(res.hint || res.error || '读取失败'))
    return {
      model: res.model || '',
      vendor: res.vendor || 'Geehy',
      uid: res.uid || '',
      uid_length: res.uid_length ?? 0,
      cpuid: res.cpuid || '',
      dev_id: res.dev_id || '',
      rev_id: res.rev_id || '',
      flash_kb: res.flash_kb ?? null,
    }
  } catch (err: any) {
    const raw = err?.message || '读取失败'
    const hint = err?.data?.statusMessage || ''
    const msg = raw === 'no_probe'
      ? '未检测到 CMSIS-DAP 探针（确认 LinkE 处于 DAP 模式、已插 USB）'
      : raw === 'no_device'
        ? 'CPUID 无有效应答（确认 SWD 四线、芯片上电）'
        : raw === 'bad_signature'
          ? (hint || '系统存储区 UID 读出全空（核对接线或反馈日志）')
          : raw.startsWith('attach_failed')
            ? (hint || 'SWD 附加失败（确认 SWDIO/SWCLK/GND/3V3 四线、芯片已上电、LinkE 为 DAP 模式）')
            : raw
    if (logId) {
      const e = logs.get(logId)
      if (e) { e.done = true; e.ok = false; e.result = { error: msg } }
    }
    throw createError({ statusCode: 500, statusMessage: `APM32 读取失败: ${msg}` })
  }
})
