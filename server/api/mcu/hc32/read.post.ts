/**
 * POST /api/mcu/hc32/read —— XHSC 小华（原华大 HDSC）HC32 系列 SWD 信息读取
 *
 * body: { logId?: string }
 *  - 传输：pyOCD（WCH-LinkE DAP 模式 = CMSIS-DAP，免驱）
 *  - 识别：CPUID 诊断 + 电子签名区直读（HDSC 官方无 DBG_IDCODE/DEV_ID 实锤）
 *    UID 10 字节 @0x0010 0E74-0x0010 0E7F（DS Rev2.72 §电子签名）；同时 dump 16B 窗口
 *    （0x0010 0E70 起）供核对——老版 DS 曾写 16Byte @0xE70，版本演化以 Rev2.72 为准
 *  - ⚠️ 硬件坑：VCAP（LDO 内核供电输出）官方要求接 4.7uF 电容，悬空 → 读数位拉 1 污染
 *    （档案 #59 旧 UID 中间含 FFFF 即此因）；UID 含连续 FF 时日志会警告
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

  // ---- 模式保险：HC32 走 SWD 需要 LinkE 处于 DAP 模式 ----
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
      pythonScriptPath('hc32_read.py'),
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
      vendor: res.vendor || 'XHSC',
      uid: res.uid || '',
      uid_length: res.uid_length ?? 0,
      cpuid: res.cpuid || '',
      dev_id: res.dev_id || '',
      uid_window: res.uid_window || '',
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
          ? (hint || '签名区 UID 读出全空（核对接线或反馈日志）')
          : raw.startsWith('attach_failed')
            ? (hint || 'SWD 附加失败（确认 SWDIO/SWCLK/GND/3V3 四线、芯片已上电、LinkE 为 DAP 模式）')
            : raw
    if (logId) {
      const e = logs.get(logId)
      if (e) { e.done = true; e.ok = false; e.result = { error: msg } }
    }
    throw createError({ statusCode: 500, statusMessage: `HC32 读取失败: ${msg}` })
  }
})
