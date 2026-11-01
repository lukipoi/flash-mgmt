/** 生成/获取固定设备码，同时返回局域网地址候选 */

import { getFixedPair, getLanIps } from '../../utils/scanPair'

export default defineEventHandler(async (event) => {
  // 端口从请求 Host 头取（浏览器访问 localhost:3080 → 3080）
  const host = String(event.node.req.headers.host || '')
  const port = host.includes(':') ? host.split(':').pop() || '' : ''

  return { code: getFixedPair(), ips: getLanIps(), port }
})
