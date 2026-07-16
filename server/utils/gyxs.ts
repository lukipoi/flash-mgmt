import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ProbeResult } from '../../shared/types'

const execAsync = promisify(exec)

// gyxs 工具路径
const PROJECT_ROOT = 'd:\\CH341-SPI'
const GYXS_JAR_PATH = join(PROJECT_ROOT, 'build', 'libs', 'gyxs.jar')
const GYXS_EXE_PATH = join(PROJECT_ROOT, 'gyxs.exe')
const GYXS_MODULES_DIR = join(PROJECT_ROOT, 'build', 'libs')

// 探测脚本内容
// 读取 JEDEC ID (0x9F), UID (0x4B), SR1 (0x05), SR2 (0x35)
const PROBE_SCRIPT = `OPEN()
PRINT("===GYXS_PROBE_START===")
jedec = TRANSFER(0x9F, 0x00, 0x00, 0x00)
PRINT("JEDEC:" + HEX(GET_BYTE(jedec, 1)) + "," + HEX(GET_BYTE(jedec, 2)) + "," + HEX(GET_BYTE(jedec, 3)))
sr1 = SEND_READ(0x05, READ:1)
PRINT("SR1:" + HEX(GET_BYTE(sr1, 0)))
sr2 = SEND_READ(0x35, READ:1)
PRINT("SR2:" + HEX(GET_BYTE(sr2, 0)))
uid_raw = TRANSFER(0x4B, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00)
PRINT("UID:" + HEX(GET_BYTE(uid_raw, 5)) + "," + HEX(GET_BYTE(uid_raw, 6)) + "," + HEX(GET_BYTE(uid_raw, 7)) + "," + HEX(GET_BYTE(uid_raw, 8)) + "," + HEX(GET_BYTE(uid_raw, 9)) + "," + HEX(GET_BYTE(uid_raw, 10)) + "," + HEX(GET_BYTE(uid_raw, 11)) + "," + HEX(GET_BYTE(uid_raw, 12)) + "," + HEX(GET_BYTE(uid_raw, 13)) + "," + HEX(GET_BYTE(uid_raw, 14)) + "," + HEX(GET_BYTE(uid_raw, 15)) + "," + HEX(GET_BYTE(uid_raw, 16)) + "," + HEX(GET_BYTE(uid_raw, 17)) + "," + HEX(GET_BYTE(uid_raw, 18)) + "," + HEX(GET_BYTE(uid_raw, 19)) + "," + HEX(GET_BYTE(uid_raw, 20)))
PRINT("===GYXS_PROBE_END===")
CLOSE()`

/**
 * 检查是否有 java 进程正在运行（避免设备冲突）
 * 异步版本，不阻塞事件循环
 */
async function isJavaRunningAsync(): Promise<boolean> {
  try {
    const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq java.exe" /NH', {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
    })
    return stdout.includes('java.exe')
  } catch {
    return false
  }
}

/**
 * 将 0xXX 格式的十六进制字符串转换为 XX 格式
 */
function hexToBytes(hexStr: string): string {
  return hexStr
    .split(',')
    .map((h) => h.trim().replace(/^0x/i, '').toUpperCase().padStart(2, '0'))
    .join(' ')
}

/**
 * 解析 gyxs 输出，提取探测结果
 */
function parseProbeOutput(output: string): ProbeResult {
  const lines = output.split(/\r?\n/)

  let jedecRaw: string | null = null
  let sr1Raw: string | null = null
  let sr2Raw: string | null = null
  let uidRaw: string | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('JEDEC:')) {
      jedecRaw = trimmed.substring('JEDEC:'.length)
    } else if (trimmed.startsWith('SR1:')) {
      sr1Raw = trimmed.substring('SR1:'.length)
    } else if (trimmed.startsWith('SR2:')) {
      sr2Raw = trimmed.substring('SR2:'.length)
    } else if (trimmed.startsWith('UID:')) {
      uidRaw = trimmed.substring('UID:'.length)
    }
  }

  if (!jedecRaw || !uidRaw || !sr1Raw || !sr2Raw) {
    throw new Error('解析 gyxs 输出失败: 缺少必要字段')
  }

  // JEDEC ID: "0x85,0x60,0x14" -> "85 60 14"
  const jedec_id = hexToBytes(jedecRaw)

  // SR1/SR2: "0x02" -> "0x02"
  const sr1 = sr1Raw.trim()
  const sr2 = sr2Raw.trim()

  // UID: "0xAB,0xCD,..." -> "AB CD ..."
  const uidBytes = uidRaw
    .split(',')
    .map((h) => h.trim().replace(/^0x/i, '').toUpperCase().padStart(2, '0'))

  // 检测 UID 长度：如果后半部分全为 00 或 FF，则可能是 8 字节 UID
  const last8 = uidBytes.slice(8)
  const isAllZero = last8.every((b) => b === '00')
  const isAllFF = last8.every((b) => b === 'FF')

  const uid_length = isAllZero || isAllFF ? 8 : 16
  const uid = uidBytes.slice(0, uid_length).join(' ')

  return {
    jedec_id,
    uid,
    uid_length,
    sr1,
    sr2,
  }
}

// CH341 连接状态检测脚本
const STATUS_SCRIPT = `OPEN()
PRINT("CH341_OK")
CLOSE()`

/**
 * 异步执行 gyxs 脚本（不阻塞事件循环）
 */
async function runGyxsScriptAsync(scriptPath: string, timeout = 10000): Promise<string> {
  const env = {
    ...process.env,
    GYXS_MODULES_DIR,
  }

  if (existsSync(GYXS_JAR_PATH)) {
    const cmd = `java -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8 -jar "${GYXS_JAR_PATH}" "${scriptPath}"`
    const { stdout } = await execAsync(cmd, {
      cwd: PROJECT_ROOT,
      env,
      timeout,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    })
    return stdout
  }

  if (existsSync(GYXS_EXE_PATH)) {
    const { stdout } = await execAsync(`"${GYXS_EXE_PATH}" "${scriptPath}"`, {
      cwd: PROJECT_ROOT,
      env,
      timeout,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    })
    return stdout
  }

  throw new Error('找不到 gyxs 工具: gyxs.jar 和 gyxs.exe 均不存在')
}

/**
 * 检测 CH341 设备是否可用（异步，不阻塞事件循环）
 */
export async function checkCh341Status(): Promise<{ connected: boolean; reason?: string }> {
  if (await isJavaRunningAsync()) {
    return { connected: false, reason: 'java 进程占用' }
  }

  const tempScriptPath = join(tmpdir(), `gyxs_status_${Date.now()}.gyxs`)
  writeFileSync(tempScriptPath, STATUS_SCRIPT, 'utf-8')

  try {
    const output = await runGyxsScriptAsync(tempScriptPath, 10000)
    const ok = output.includes('CH341_OK')
    return { connected: ok, reason: ok ? undefined : '未检测到 CH341 设备' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { connected: false, reason: message }
  } finally {
    if (existsSync(tempScriptPath)) {
      try {
        unlinkSync(tempScriptPath)
      } catch {
        // 忽略清理错误
      }
    }
  }
}

/**
 * 探测连接的 Flash 芯片（异步版本）
 */
export async function probeChipAsync(): Promise<ProbeResult> {
  if (await isJavaRunningAsync()) {
    return {
      jedec_id: '',
      uid: '',
      uid_length: 8,
      sr1: '',
      sr2: '',
      error: '检测到 java 进程正在运行，请关闭后重试'
    }
  }

  const tempScriptPath = join(tmpdir(), `gyxs_probe_${Date.now()}.gyxs`)
  writeFileSync(tempScriptPath, PROBE_SCRIPT, 'utf-8')

  try {
    const output = await runGyxsScriptAsync(tempScriptPath, 30000)
    return parseProbeOutput(output)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      jedec_id: '',
      uid: '',
      uid_length: 8,
      sr1: '',
      sr2: '',
      error: message
    }
  } finally {
    if (existsSync(tempScriptPath)) {
      try {
        unlinkSync(tempScriptPath)
      } catch {
        // 忽略清理错误
      }
    }
  }
}
