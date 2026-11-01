/**
 * GET /api/mcu/stc/ports —— 列出可用串口（供 STC 读取选择）
 */
export default defineEventHandler(async () => {
  const script = pythonScriptPath('stc_read.py')
  try {
    const res = await runPythonScript(script, ['--ports'], 15_000)
    if (!res.ok) throw new Error(String(res.error || '枚举失败'))
    return { ports: res.ports || [] }
  } catch (err: any) {
    throw createError({ statusCode: 500, statusMessage: err?.message || '枚举串口失败' })
  }
})
