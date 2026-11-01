/**
 * POST /api/mcu/at32/read —— AT32 / GD32 等 ARM Cortex-M 芯片 SWD 信息读取
 *
 * body: { logId?: string }
 *  - 传输：pyOCD（WCH-LinkE DAP 模式 = CMSIS-DAP，免驱）
 *  - 识别：Artery 官方 AN0016 算法（PID @0xE0042000 + 系列字节 @0x1FFFF7F3 → 64 位 ID
 *    查 at32IdTable.json 65 条官方映射）+ UID 96bit @0x1FFFF7E8
 *  - 模式保险：LinkE 必须 DAP 模式（与 CH32V 的 RV 相反），读取前自动检测并切换
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

  // ---- 模式保险：AT32 走 SWD 需要 LinkE 处于 DAP 模式（上次 CH32V 会话忘切回是高频事故）----
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
      pythonScriptPath('at32_read.py'),
      [],
      60_000,
      pushLog,
    )
    if (logId) {
      const e = logs.get(logId)
      if (e) { e.done = true; e.ok = true; e.result = res }
    }
    if (!res.ok) throw new Error(String(res.error || '读取失败'))
    return {
      model: res.model || '',
      vendor: res.vendor || '',
      uid: res.uid || '',
      uid_length: res.uid_length ?? 0,
      id64: res.id64 || '',
      dev_id: res.dev_id || '',
      flash_kb: res.flash_kb ?? null,
      package: res.package ?? null,
      matched_table: !!res.matched_table,
    }
  } catch (err: any) {
    const raw = err?.message || '读取失败'
    const msg = raw === 'no_probe'
      ? '未检测到 CMSIS-DAP 探针（确认 LinkE 处于 DAP 模式、已插 USB）'
      : raw.startsWith('attach_failed')
        ? raw.replace('attach_failed: ', '')
        : raw
    if (logId) {
      const e = logs.get(logId)
      if (e) { e.done = true; e.ok = false; e.result = { error: msg } }
    }
    throw createError({ statusCode: 500, statusMessage: `AT32 读取失败: ${msg}` })
  }
})
