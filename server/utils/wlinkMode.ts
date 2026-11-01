/**
 * WCH-LinkE 模式检测与自动切换
 *
 * LinkE 有两种工作模式（设备管理器可见名称不同，Adafruit/官方文档实锤）：
 *   - RV  模式：MI_00 友好名 = "WCH-LinkRV"     → 调 WCH RISC-V 芯片（CH32V 等，SWIO 单线）
 *   - DAP 模式：MI_00 友好名 = "WCH CMSIS-DAP"  → 当 CMSIS-DAP 调试器用（AT32/STM32 等 ARM，SWD）
 *
 * 模式错了 wlink 的报错很难看懂（attach 无应答 0x55 之类），所以在读取前
 * 先查 PnP 友好名判断当前模式，不对就用 wlink mode-switch 官方子命令自动切回。
 * 切换后 USB 会重新枚举，需要等一小会儿再验证。
 */
import { spawn } from 'node:child_process'

export type LinkEMode = 'rv' | 'dap' | 'unknown'

/* 实测：RV 模式 PID=8010（友名 WCH-LinkRV），DAP 模式 PID=8012（友名 WCH CMSIS-DAP）——
 * DAP 下 8010 过滤器什么都查不到，必须两个 PID 都匹配 */
const LINK_PNP_FILTER = '*VID_1A86&PID_801*'

/** 查询 LinkE 当前模式（读 PnP 友好名，只读零风险；查不到 = unknown） */
export function getLinkEMode(): Promise<LinkEMode> {
  return new Promise((resolve) => {
    // PowerShell：只取 LinkE 调试接口（MI_00）的友好名，避免 SERIAL 接口干扰
    const cmd = `Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like '${LINK_PNP_FILTER}' } | ForEach-Object { $_.FriendlyName }`
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', cmd], { windowsHide: true })
    let out = ''
    const timer = setTimeout(() => { child.kill('kill'); resolve('unknown') }, 15_000)
    child.stdout.on('data', (d: Buffer) => { out += d.toString('utf-8') })
    child.stderr.on('data', () => { /* 忽略 */ })
    child.on('close', () => {
      clearTimeout(timer)
      const names = out.toLowerCase()
      if (names.includes('linkrv')) resolve('rv')
      else if (names.includes('cmsis-dap') || names.includes('pid_8012')) resolve('dap')
      else resolve('unknown')
    })
    child.on('error', () => { clearTimeout(timer); resolve('unknown') })
  })
}

/** 用官方子命令切模式。返回是否切换成功（含等待重枚举后的复验）。 */
export async function switchLinkEMode(target: 'rv' | 'dap', exePath: string, log?: (line: string) => void): Promise<boolean> {
  log?.(`[INFO] wlink mode-switch --${target}（切换后 USB 会重新枚举）`)
  const ok = await new Promise<boolean>((resolve) => {
    const child = spawn(exePath, ['mode-switch', `--${target}`], { windowsHide: true })
    let err = ''
    const timer = setTimeout(() => { child.kill('kill'); resolve(false) }, 20_000)
    child.stdout.on('data', (d: Buffer) => log?.(d.toString('utf-8').trim()))
    child.stderr.on('data', (d: Buffer) => { err += d.toString('utf-8') })
    child.on('close', (code) => { clearTimeout(timer); resolve(code === 0) })
    child.on('error', (e) => { clearTimeout(timer); log?.(`[ERR] ${e.message}`); resolve(false) })
    void err
  })
  if (!ok) return false

  // 等 USB 重新枚举（设备名/接口会变），然后复验
  await new Promise(r => setTimeout(r, 2500))
  const mode = await getLinkEMode()
  log?.(`[INFO] 切换后模式复验: ${mode === 'rv' ? 'RV' : mode === 'dap' ? 'DAP' : '未知'}`)
  return mode === target
}
