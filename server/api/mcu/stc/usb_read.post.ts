/**
 * POST /api/mcu/stc/usb_read —— STC USB ISP 芯片信息读取（AI8H2K12U 等 USB 型 STC）
 *
 * body: { logId?: string }
 *  - 芯片走 USB HID（VID 0x34BF / PID 0x1001，product "USB-ISP"），免驱免串口
 *  - 进 BOOT：P3.2 短接 GND + 重新上电（识别后 P3.2 无关）；脚本内轮询等待 20s
 *  - 协议：Wireshark+USBPcap 抓官方 STC-ISP 成功会话逆向（帧 46B9+6a/68+len+cs+16，
 *    命令 07 同步/01 握手/05 解锁/03 读 UID/ff 结束），详见 stc_usb_read.py 头注
 *  - logId 复用 __stcLogs（GET /api/mcu/stc/log 轮询端点）
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
  const logId = String(body?.logId || '')
  if (logId) {
    while (logs.size >= 20) {
      logs.delete(logs.keys().next().value as string)
    }
    logs.set(logId, { lines: [], done: false, ok: false, result: null })
  }

  try {
    const res = await runPythonScript(
      pythonScriptPath('stc_usb_read.py'),
      [],
      60_000,
      logId ? (line: string) => logs.get(logId)?.lines.push(line) : undefined,
    )
    if (logId) {
      const e = logs.get(logId)
      if (e) { e.done = true; e.ok = true; e.result = res }
    }
    if (!res.ok) throw new Error(String(res.error || '读取失败'))
    return {
      model: res.model || '',
      uid: res.uid || '',
      uid_length: res.uid_length ?? 0,
      status_hex: res.status_hex || '',
    }
  } catch (err: any) {
    const msg = err?.message === 'no_device'
      ? '未检测到 STC USB-ISP 设备（P3.2 短接 GND + 重新上电后再试）'
      : err?.message === 'sync_timeout'
        ? '同步命令无应答（确认 P3.2 短接后重新上电、STC-ISP 已关闭）'
        : err?.message || '读取失败'
    if (logId) {
      const e = logs.get(logId)
      if (e) { e.done = true; e.ok = false; e.result = { error: msg } }
    }
    throw createError({ statusCode: 500, statusMessage: `STC USB 读取失败: ${msg}` })
  }
})
