/**
 * GET /api/mcu/stc/log?logId=xxx —— 轮询 STC 读取的实时日志（wlink/stcgal 原文）
 * 返回 { lines, done, ok, result }；done=true 后前端停止轮询并自动关日志框
 */
export default defineEventHandler((event) => {
  const logId = getQuery(event).logId as string
  const logs = (globalThis as any).__stcLogs as Map<string, any> | undefined
  const entry = logs?.get(logId)
  if (!entry) {
    throw createError({ statusCode: 404, statusMessage: '日志不存在或已过期' })
  }
  return {
    lines: entry.lines,
    done: entry.done,
    ok: entry.ok,
    result: entry.result,
  }
})
