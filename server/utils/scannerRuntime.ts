/**
 * 扫描仪运行时：spawn 本机 Python 执行 WIA 扫描 + zxing 解码。
 *
 * WIA 是 Windows COM，只有 Python(pywin32) 能调，Node 侧通过子进程单次调用，
 * 不常驻独立服务。脚本位于 server/python/scan_once.py，依赖本机全局 Python
 * 已安装 pywin32 / Pillow / numpy / zxing-cpp（与 EXP-SCAN 同一环境）。
 */
import { spawn } from 'node:child_process'
import path from 'node:path'

export interface ScannerInfo {
  id: string
  name: string
}

export interface DecodedText {
  text: string
  format: string
}

export interface ScanOnceResult {
  ok: boolean
  error?: string
  scanners?: ScannerInfo[]
  texts?: DecodedText[]
  elapsed_ms?: number
}

const SCRIPT_PATH = path.join(process.cwd(), 'server', 'python', 'scan_once.py')

function pythonExe(): string {
  return process.platform === 'win32' ? 'python' : 'python3'
}

/**
 * 通用 Python 脚本执行器：spawn 单次调用，stdout 必须是 UTF-8 JSON。
 * 供扫描仪（scan_once.py）与 STC 读取（stc_read.py）共用，不常驻服务。
 */
export function runPythonScript(
  scriptPath: string,
  args: string[],
  timeoutMs = 90_000,
  onLog?: (line: string) => void,
): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonExe(), ['-X', 'utf8', scriptPath, ...args], {
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    let logBuf = ''
    const timer = setTimeout(() => {
      child.kill('kill')
      reject(new Error('python 脚本超时'))
    }, timeoutMs)

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf-8') })
    child.stderr.on('data', (d: Buffer) => {
      const text = d.toString('utf-8')
      stderr += text
      if (onLog) {
        // 按行拆分实时回调（最后一行可能不完整，留在缓冲）
        logBuf += text
        const lines = logBuf.split(/\r?\n/)
        logBuf = lines.pop() || ''
        for (const line of lines) {
          if (line.trim()) onLog(line)
        }
      }
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (onLog && logBuf.trim()) onLog(logBuf)
      const trimmed = stdout.trim()
      if (trimmed) {
        try {
          resolve(JSON.parse(trimmed) as Record<string, any>)
          return
        } catch {
          // stdout 不是合法 JSON，落到下面的错误分支
        }
      }
      reject(new Error(stderr.trim() || `python 退出码 ${code}，无输出`))
    })

    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`无法启动 python（确认已安装并加入 PATH）: ${e.message}`))
    })
  })
}

/** server/python 下脚本绝对路径（供各 API 复用）。 */
export function pythonScriptPath(name: string): string {
  return path.join(process.cwd(), 'server', 'python', name)
}

/** wlink.exe（ch32-rs/wlink nightly x86 build）绝对路径：STC 控电与 CH32V 读写共用。 */
export function wlinkExePath(): string {
  return path.join(process.cwd(), 'server', 'python', 'bin', 'wlink-win-x86', 'wlink.exe')
}

export interface RunExeResult {
  ok: boolean
  logs: string[]
  error?: string
}

/**
 * 通用可执行文件运行器：spawn 单次调用，stdout/stderr 全部按行收集并实时回调。
 * 供 CH32V 读取（wlink status：日志走 stdout，错误走 stderr）使用，
 * 解析由调用方按日志行正则完成——wlink 不输出 JSON。
 */
export function runExe(
  exePath: string,
  args: string[],
  timeoutMs = 60_000,
  onLog?: (line: string) => void,
): Promise<RunExeResult> {
  return new Promise((resolve) => {
    const child = spawn(exePath, args, { windowsHide: true })
    const logs: string[] = []
    // wlink 正常日志走 stdout（simple_logger），错误走 stderr，两边都收
    let outBuf = ''
    let errBuf = ''
    const timer = setTimeout(() => {
      child.kill('kill')
      resolve({ ok: false, logs, error: 'wlink 执行超时' })
    }, timeoutMs)

    const pushLine = (line: string) => {
      // 剥掉 ANSI 颜色码，保留 [INFO]/[WARN] 级别与正文
      const clean = line.replace(/\x1b\[[0-9;]*m/g, '')
      logs.push(clean)
      if (onLog) onLog(clean)
    }

    child.stdout.on('data', (d: Buffer) => {
      outBuf += d.toString('utf-8')
      const lines = outBuf.split(/\r?\n/)
      outBuf = lines.pop() || ''
      for (const line of lines) {
        if (line.trim()) pushLine(line)
      }
    })
    child.stderr.on('data', (d: Buffer) => {
      errBuf += d.toString('utf-8')
      const lines = errBuf.split(/\r?\n/)
      errBuf = lines.pop() || ''
      for (const line of lines) {
        if (line.trim()) pushLine(line)
      }
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      for (const rest of [outBuf, errBuf]) {
        if (rest.trim()) pushLine(rest)
      }
      const ok = code === 0
      resolve({
        ok,
        logs,
        error: ok ? undefined : (logs.filter(l => /error|错误/i.test(l)).join('; ') || `wlink 退出码 ${code}`),
      })
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ ok: false, logs, error: `无法启动 wlink: ${e.message}` })
    })
  })
}

/** 执行 scan_once.py，JSON 解析失败或进程错误时抛异常（error 信息取自 stderr）。 */
export function runScanOnce(args: string[], timeoutMs = 90_000): Promise<ScanOnceResult> {
  return runPythonScript(SCRIPT_PATH, args, timeoutMs) as Promise<ScanOnceResult>
}
