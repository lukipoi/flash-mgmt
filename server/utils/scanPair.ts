/** 手机扫码配对（固定设备码，SQLite 持久化；推送队列为内存存储） */

import os from 'node:os'
import { db } from '../database/init'

export function scanPairKey(pair: string) {
  return `scan:${pair}`
}

/**
 * 固定设备码：首次访问生成后写入 settings 表，此后重启不变
 * 手机端记住一次即可长期使用，无需每次重新配对
 */
let fixedPair: string | null = null
export function getFixedPair(): string {
  if (fixedPair) return fixedPair
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)')
  const row = db.prepare("SELECT value FROM settings WHERE key = 'scan_pair'").get() as { value: string } | undefined
  if (row?.value) {
    fixedPair = row.value
    return fixedPair
  }
  fixedPair = String(Math.floor(100000 + Math.random() * 900000))
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('scan_pair', ?)").run(fixedPair)
  return fixedPair
}

/** 取推送队列；不存在则惰性创建空箱 */
export async function getOrCreateBox(pair: string): Promise<{ queue: string[] }> {
  const storage = useStorage('memory')
  let box = await storage.getItem<{ queue: string[] }>(scanPairKey(pair))
  if (!box) {
    box = { queue: [] }
    await storage.setItem(scanPairKey(pair), box)
  }
  return box
}

/**
 * 局域网 IPv4 候选
 * 只认 192.168.1.* 网段（用户的 WiFi 网卡），排除 VMware 等虚拟网卡；
 * 该网段不存在时才退回全部非内部 IPv4（按 192.168 → 10. → 172. → 其他排序）
 */
export function getLanIps(): string[] {
  const ips: string[] = []
  const ifaces = os.networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address)
    }
  }
  const wifi = ips.filter(ip => ip.startsWith('192.168.1.'))
  if (wifi.length) return wifi
  const rank = (ip: string) => ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3
  return ips.sort((a, b) => rank(a) - rank(b))
}
