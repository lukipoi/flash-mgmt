/**
 * POST /api/mcu/ch55/read —— CH55x（8051）ISP 芯片信息读取（只读 identify）
 *
 * body: { mode?: 'usb' | 'serial', port?: string, autoCycle?: boolean, logId?: string }
 *  - mode='usb'（默认，现用）：CH55x 冷启动 + D+ 高电平进出厂 BOOT 后插 USB（BOOT 模式
 *    PID=0x55E0，官方 Setup 已装驱动），无需串口无需控电
 *  - mode='serial'：WCH-LinkE SERIAL 接 UART，autoCycle 时 wlink 软件控 3V3 冷启动
 *    （官方论坛 thread-85867 实锤：冷启动 + D+ 高电平进 BOOT；出厂 2KB BOOT 删不掉）
 *  - 两者都 spawn ch55x_identify.exe（运行时加载官方 WCH55xISPDLL.dll）：
 *    SetIspOption → EnumDevices → （串口再加 GetIspDeviceInfor），全程只读
 *
 * stdout 约定（与 stc_read.py 同款）：exe 的 stdout 只输出最终 JSON，过程日志走 stderr。
 * 日志缓冲复用 __stcLogs（GET /api/mcu/stc/log 轮询端点）。
 */
import path from 'node:path'

const logs = ((globalThis as any).__stcLogs ||= new Map<string, {
  lines: string[]
  done: boolean
  ok: boolean
  result: Record<string, any> | null
}>())

function ch55xExePath(): string {
  return path.join(process.cwd(), 'server', 'python', 'bin', 'wch-ispcmd', 'Windows', 'ch55x_identify.exe')
}

/** McuType（型号后两位）→ 常见型号名；对不上时回退 CH55x(0xXX) */
function mcuTypeToModel(t: number): string {
  const map: Record<number, string> = {
    0x51: 'CH551',
    0x52: 'CH552',
    0x53: 'CH553',
    0x54: 'CH554',
    0x57: 'CH557',
    0x58: 'CH558',
    0x59: 'CH559',
  }
  return map[t] ?? `CH55x(0x${t.toString(16).toUpperCase().padStart(2, '0')})`
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** 从 ch55x_identify 的日志行里取最终 JSON（stdout 单行输出） */
function parseToolJson(lines: string[]): Record<string, any> | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line.startsWith('{"ok"')) {
      try { return JSON.parse(line) } catch { return null }
    }
  }
  return null
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, any>>(event).catch(() => ({}))
  const mode = body?.mode === 'serial' ? 'serial' : 'usb'
  const port = String(body?.port || '').trim()
  const autoCycle = !!body?.autoCycle
  if (mode === 'serial' && !port) {
    throw createError({ statusCode: 400, statusMessage: '缺少串口号 port' })
  }

  const logId = String(body?.logId || '')
  if (logId) {
    // 防泄漏：最多留 20 份日志
    while (logs.size >= 20) {
      logs.delete(logs.keys().next().value as string)
    }
    logs.set(logId, { lines: [], done: false, ok: false, result: null })
  }
  const pushLog = logId ? (line: string) => logs.get(logId)?.lines.push(line) : undefined

  const finish = (ok: boolean, result: Record<string, any>) => {
    if (logId) {
      const e = logs.get(logId)
      if (e) { e.done = true; e.ok = ok; e.result = result }
    }
    return result
  }

  // 串口 ISP 握手对上电瞬间的垃圾字节敏感（同 stcgal 教训）：串口+自动控电模式下整段
  // 「断电→上电→握手」最多重试 3 次，无控电 2 次。
  // USB 模式：设备空闲可能被挂起/楔死（CH375 传输报错 31），每次失败后做一次
  // wlink 断电重启（芯片重上电 = USB 层拔插事件，恢复挂起状态），最多 3 次。
  const maxAttempts = mode === 'serial' ? (autoCycle ? 3 : 2) : 3
  const toolArgs = mode === 'serial'
    ? ['--port', port, '--baud', '115200', '--mcu-type', '0x52', '--series', '0x00']
    : ['--usb']
  let lastError = '读取失败'

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (mode === 'serial') {
        if (autoCycle) {
          pushLog?.(`--- wlink set-power disable3v3（第 ${attempt}/${maxAttempts} 次）---`)
          const off = await runExe(wlinkExePath(), ['set-power', 'disable3v3'], 20_000, pushLog)
          if (!off.ok) pushLog?.(`[WARN] 断电指令异常: ${off.error || '未知'}`)
          await sleep(600)
          pushLog?.('--- wlink set-power enable3v3（冷启动，D+ 高电平触发 ISP）---')
          const on = await runExe(wlinkExePath(), ['set-power', 'enable3v3'], 20_000, pushLog)
          if (!on.ok) pushLog?.(`[WARN] 上电指令异常: ${on.error || '未知'}`)
          await sleep(200)  // 给 BOOT 一点上电稳定时间
        } else {
          pushLog?.(`--- 直接握手（第 ${attempt}/${maxAttempts} 次，未启用自动断电重启）---`)
        }
      } else {
        if (attempt > 1) {
          // USB 恢复大法：芯片断电重启 → USB 总线上真实拔插事件，清掉挂起/楔死状态
          pushLog?.(`--- wlink 断电重启恢复 USB 设备（第 ${attempt}/${maxAttempts} 次尝试前）---`)
          const off = await runExe(wlinkExePath(), ['set-power', 'disable3v3'], 20_000, pushLog)
          if (!off.ok) pushLog?.(`[WARN] 断电指令异常: ${off.error || '未知'}`)
          await sleep(1000)
          const on = await runExe(wlinkExePath(), ['set-power', 'enable3v3'], 20_000, pushLog)
          if (!on.ok) pushLog?.(`[WARN] 上电指令异常: ${on.error || '未知'}`)
          await sleep(1500)  // 等 Windows 完成重枚举
        }
        pushLog?.(`--- USB ISP 读取（第 ${attempt}/${maxAttempts} 次，BOOT 模式 PID=0x55E0）---`)
      }

      const res = await runExe(ch55xExePath(), toolArgs, 90_000, pushLog)

      const parsed = parseToolJson(res.logs)
      if (!parsed || parsed.ok !== true) {
        lastError = '识别工具输出异常（见日志框）'
        pushLog?.(`[WARN] 第 ${attempt} 次尝试失败: ${lastError}`)
        continue
      }

      const devices: any[] = Array.isArray(parsed.devices) ? parsed.devices : []
      // 按 UID 有效性选设备：USB 模式设备可能不带 port 名，全部候选里挑 uid_valid
      const wanted = String(port).replace(/^\\\\\.\\/, '').toUpperCase()
      const byPort = mode === 'serial'
        ? devices.filter(d => String(d.port || '').toUpperCase().includes(wanted))
        : devices
      const hit = byPort.find(d => d.uid_valid) || byPort[0] || null

      if (!hit || !hit.uid || !hit.uid_valid) {
        lastError = devices.length === 0
          ? (mode === 'usb'
              ? '未枚举到 CH55x BOOT 设备（确认冷启动时已插 USB，设备管理器应出现 PID 0x55E0 的 WCH 设备）'
              : '串口上无 CH55x 应答（确认冷启动时 D+ 为高、TX/RX 未接反）')
          : 'CH55x 在线但未取得有效 UID（重新冷启动再试）'
        pushLog?.(`[WARN] 第 ${attempt} 次尝试失败: ${lastError}`)
        continue
      }

      const uid = String(hit.uid).toUpperCase()
      const result = {
        model: mcuTypeToModel(Number(hit.mcu_type)),
        mcu_type: Number(hit.mcu_type),
        uid,
        uid_length: Number(hit.uid_length) || uid.length / 2,
        isp_ver: String(hit.isp_ver || ''),
        port: String(hit.port || port),
      }
      pushLog?.(`[INFO] 读取成功: ${result.model} UID=${uid} BOOT=v${result.isp_ver}`)
      return finish(true, result)
    } catch (err: any) {
      lastError = err?.message || '读取失败'
      pushLog?.(`[WARN] 第 ${attempt} 次尝试异常: ${lastError}`)
    }
  }

  finish(false, { error: lastError })
  throw createError({
    statusCode: 500,
    statusMessage: `CH55x 读取失败: ${lastError}`,
  })
})
