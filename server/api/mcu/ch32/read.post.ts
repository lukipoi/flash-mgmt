/**
 * POST /api/mcu/ch32/read —— WCH-LinkE 调试口读取 CH32V（RISC-V）芯片信息
 *
 * body: { logId?: string }
 *  - 直接 spawn wlink.exe status（ch32-rs/wlink）：attach 自动识别型号，
 *    ESIG 一次带回 8 字节 UID + flash 容量 + 读保护状态。
 *  - 与 STC 不同：WCH 调试口随时可连，无需断电重启；UID 在硬件电子签名区，
 *    只读不擦不写（无「空片擦除」概念），读完自动 detach 并恢复 MCU 运行。
 *  - logId：前端生成；日志行实时存入内存缓冲（复用 STC 的 __stcLogs 缓冲与
 *    GET /api/mcu/stc/log 轮询端点），供日志框展示。
 *
 * wlink status 实测输出格式（ch32-rs/wlink 源码 + 本机实测一致）：
 *   [INFO] Attached chip: CH32V003 [CH32V003J4M6] (ChipID: 0x00330510)
 *   [INFO] Chip ESIG: FlashSize(16KB) UID(cd-ab-1d-79-f7-bd-e1-e2)
 *   [INFO] Flash protected: false
 */

const logs = ((globalThis as any).__stcLogs ||= new Map<string, {
  lines: string[]
  done: boolean
  ok: boolean
  result: Record<string, any> | null
}>())

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, any>>(event).catch(() => ({}))
  const logId = String(body?.logId || '')
  if (logId) {
    // 防泄漏：最多留 20 份日志
    while (logs.size >= 20) {
      logs.delete(logs.keys().next().value as string)
    }
    logs.set(logId, { lines: [], done: false, ok: false, result: null })
  }

  const pushLog = logId ? (line: string) => logs.get(logId)?.lines.push(line) : undefined

  // ---- 模式保险：LinkE 在 RV/DAP 双模式间切换后忘切回来是高频事故，
  // ---- DAP 模式下 wlink 的报错（0x55 attach 无应答）完全看不出真因。
  // ---- 读取前查 PnP 友好名，DAP 模式就用官方子命令自动切回 RV。
  try {
    const mode = await getLinkEMode()
    if (mode === 'dap') {
      pushLog?.('[WARN] 检测到 LinkE 处于 DAP 模式（上次 AT32/STM32 会话忘切回），自动切换 RV...')
      const ok = await switchLinkEMode('rv', wlinkExePath(), pushLog)
      if (!ok) {
        const err = 'LinkE 自动切回 RV 模式失败，请用 WCH-LinkUtility 手动切换（设置 → DAP-LINK/RV 模式）后重试'
        pushLog?.(`[ERR] ${err}`)
        if (logId) {
          const e = logs.get(logId)
          if (e) { e.done = true; e.ok = false; e.result = { error: err } }
        }
        throw createError({ statusCode: 409, statusMessage: err })
      }
    } else if (mode === 'unknown') {
      pushLog?.('[WARN] 未检测到 WCH-LinkE（若芯片读取失败请确认探针已插好）')
    } else {
      pushLog?.('[INFO] LinkE 模式检查通过（RV）')
    }
  } catch (err: any) {
    // 模式自动切换失败已在此前抛 409；其余（如 PowerShell 查询异常）不阻断读取
    if (err?.statusCode === 409) throw err
    pushLog?.(`[WARN] 模式检查跳过: ${err?.message || '未知'}`)
  }

  const res = await runExe(
    wlinkExePath(),
    ['status'],
    60_000,
    logId ? (line: string) => logs.get(logId)?.lines.push(line) : undefined,
  )

  const parseError = (err: string | undefined) => {
    if (!err) return '读取失败'
    // wlink 协议错误 0x55 = attach 无应答：接线/供电问题
    if (/0x55/.test(err)) {
      return '芯片未响应（确认 SWIO/SCK/GND/3V3 四根线接好，LinkE 处于 RV 模式）'
    }
    return `读取失败: ${err.replace(/^Error: /, '')}`
  }

  if (!res.ok) {
    if (logId) {
      const e = logs.get(logId)
      if (e) { e.done = true; e.ok = false; e.result = { error: parseError(res.error) } }
    }
    throw createError({ statusCode: 500, statusMessage: parseError(res.error) })
  }

  const text = res.logs.join('\n')
  // Attached chip: 家族 [精确型号] (ChipID: 0x..) —— 精确型号/ChipID 来自
  // wlink 内置映射（源码 chips.rs chip_id_to_chip_name），查不到时缺省
  const attached = text.match(/Attached chip: (\S+)(?: \[([^\]]+)\])?(?: \(ChipID: 0x([0-9a-fA-F]+)\))?/)
  const esig = text.match(/Chip ESIG: FlashSize\((\d+)KB\) UID\(([^)]+)\)/)
  const protectedMatch = text.match(/Flash protected: (true|false)/)

  if (!attached) {
    if (logId) {
      const e = logs.get(logId)
      if (e) { e.done = true; e.ok = false; e.result = { error: '读取失败: 日志中无芯片信息' } }
    }
    throw createError({ statusCode: 500, statusMessage: '读取失败: 日志中未找到芯片信息（attach 可能未完成）' })
  }

  const uid = esig ? esig[2].replace(/-/g, '').toUpperCase() : ''
  const result = {
    family: attached[1],
    model: attached[2] || attached[1],
    chip_id: attached[3] ? attached[3].toUpperCase() : '',
    uid,
    uid_length: uid ? uid.length / 2 : 0,
    capacity_kb: esig ? Number(esig[1]) : null,
    protected: protectedMatch ? protectedMatch[1] === 'true' : null,
  }

  if (logId) {
    const e = logs.get(logId)
    if (e) { e.done = true; e.ok = true; e.result = result as unknown as Record<string, any> }
  }

  return result
})
