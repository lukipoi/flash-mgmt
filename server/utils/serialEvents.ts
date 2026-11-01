/**
 * 串口热插拔监听（Windows）。
 *
 * Nitro 自有常驻子进程（PowerShell，非独立服务）：每 0.8s 读注册表
 * HKLM\HARDWARE\DEVICEMAP\SERIALCOMM（内核维护的串口表，插拔即时更新，
 * 不丢事件），变化时往 stdout 打一行 DEVICE_CHANGE，Node 侧按行读取
 * 并通知订阅者（SSE 推给前端刷新串口列表）。
 * 不用 WMI 事件订阅——实测丢事件且进程易静默死亡；注册表轮询可靠得多。
 */
import { spawn, type ChildProcess } from 'node:child_process'

const PS_SCRIPT = `
$prev = ''
while ($true) {
  $cur = (Get-ItemProperty 'HKLM:\\HARDWARE\\DEVICEMAP\\SERIALCOMM' -ErrorAction SilentlyContinue) |
         ForEach-Object { $_.PSObject.Properties.Name -join ',' }
  if ($cur -ne $prev) {
    Write-Output "DEVICE_CHANGE"
    [Console]::Out.Flush()
    $prev = $cur
  }
  Start-Sleep -Milliseconds 800
}
`

type Listener = () => void

interface WatcherState {
  child: ChildProcess | null
  listeners: Set<Listener>
  buf: string
  restarting: boolean
}

// dev 模式 HMR 时用 globalThis 保单例；watcher 意外退出自动重启
const g = globalThis as any
const state: WatcherState = (g.__serialWatcher ||= { child: null, listeners: new Set(), buf: '', restarting: false })

function startWatcher() {
  if (state.child) return
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', PS_SCRIPT],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  state.child = child
  child.stdout!.on('data', (d: Buffer) => {
    state.buf += d.toString('utf-8')
    let idx: number
    while ((idx = state.buf.indexOf('DEVICE_CHANGE')) >= 0) {
      state.buf = state.buf.slice(idx + 'DEVICE_CHANGE'.length)
      for (const fn of state.listeners) {
        try { fn() } catch { /* 订阅者异常不拖垮 watcher */ }
      }
    }
  })
  child.stderr!.on('data', () => {})
  child.on('exit', () => {
    state.child = null
    // 还有订阅者就自动重启（3s 退避，防疯狂循环）
    if (state.listeners.size && !state.restarting) {
      state.restarting = true
      setTimeout(() => { state.restarting = false; startWatcher() }, 3000)
    }
  })
}

/** 订阅设备插拔事件，返回取消订阅函数。首次订阅时启动 watcher。 */
export function onSerialChange(fn: Listener): () => void {
  startWatcher()
  state.listeners.add(fn)
  return () => { state.listeners.delete(fn) }
}
