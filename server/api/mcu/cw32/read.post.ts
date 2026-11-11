/**
 * POST /api/mcu/cw32/read —— WHXY 武汉芯源 CW32 系列 SWD 信息读取
 *
 * body: { logId?: string }
 *  - 传输：pyOCD（WCH-LinkE DAP 模式 = CMSIS-DAP，免驱）
 *  - 识别：数字签名区（CW32L010 UM Rev1.1 §24 实锤，地址见脚本注释）
 *    CW32 无 ST/GD 式 DEV_ID 寄存器，签名区直接存 ASCII 产品型号字符串（自报家门）：
 *    UID 80bit @0x0010 07B0；型号 @0x0010 07E0；FLASH 容量 @0x0010 07D8；SRAM 容量 @0x0010 07D6
 *  - 顺序坑：先读 IDCODE 再做内存读（社区实测，否则 UID 可能出假数据）
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

  // ---- 模式保险：CW32 走 SWD 需要 LinkE 处于 DAP 模式 ----
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
      pythonScriptPath('cw32_read.py'),
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
      family: res.family || '',
      vendor: res.vendor || 'WHXY',
      uid: res.uid || '',
      uid_length: res.uid_length ?? 0,
      cpuid: res.cpuid || '',
      idcode: res.idcode || '',
      pin_count: res.pin_count ?? null,
      sram_kb: res.sram_kb ?? null,
      flash_kb: res.flash_kb ?? null,
      matched_table: !!res.matched_table,
    }
  } catch (err: any) {
    const raw = err?.message || '读取失败'
    const hint = err?.data?.statusMessage || ''
    const msg = raw === 'no_probe'
      ? '未检测到 CMSIS-DAP 探针（确认 LinkE 处于 DAP 模式、已插 USB）'
      : raw === 'no_device'
        ? 'CPUID 无有效应答（确认 SWD 四线、芯片上电；深度休眠下 CW32 的 DAP 会停摆）'
        : raw === 'bad_signature'
          ? (hint || '签名区型号读出异常（可能深度休眠或接线不稳）')
          : raw.startsWith('attach_failed')
            ? (hint || 'SWD 附加失败（确认 SWDIO/SWCLK/GND/3V3 四线、芯片已上电、LinkE 为 DAP 模式）')
            : raw
    if (logId) {
      const e = logs.get(logId)
      if (e) { e.done = true; e.ok = false; e.result = { error: msg } }
    }
    throw createError({ statusCode: 500, statusMessage: `CW32 读取失败: ${msg}` })
  }
})
