/**
 * GET /api/mcu/stc/events —— 串口插拔 SSE 事件流（原生实现，h3 版本无 streamSSE）。
 * Windows 设备到达/移除时 push "change"；20s 心跳保活。
 * 前端 EventSource 收到消息后重新枚举串口（实现插拔热刷新）。
 */
export default defineEventHandler((event) => {
  const res = event.node.res
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const send = (data: string) => {
    try { res.write(`data: ${data}\n\n`) } catch { /* 客户端已断开 */ }
  }
  const unbind = onSerialChange(() => send('change'))
  const heartbeat = setInterval(() => send('ping'), 20_000)
  event.node.req.on('close', () => {
    unbind()
    clearInterval(heartbeat)
  })
  // 挂住流直到客户端断开（close 时清理资源）
  return new Promise(() => {})
})
