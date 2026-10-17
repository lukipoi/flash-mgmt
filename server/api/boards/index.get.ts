import { db } from '../../database/init'

// 把 DB 行的 chips JSON 字符串解析为数组，返回干净对象
function parseBoardRow(row: any) {
  if (!row) return row
  let chips: string[] | null = null
  if (row.chips) {
    try {
      const parsed = JSON.parse(row.chips)
      chips = Array.isArray(parsed) ? parsed : null
    } catch {
      chips = null
    }
  }
  const { chips: _, ...rest } = row
  return { ...rest, chips }
}

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const { search, status } = query

  let sql = 'SELECT * FROM circuit_boards WHERE 1=1'
  const params: any[] = []

  if (search) {
    const s = `%${String(search)}%`
    sql += ' AND (brand LIKE ? OR model LIKE ? OR serial_number LIKE ? OR note LIKE ? OR chips LIKE ?)'
    // chips LIKE 能搜到 JSON 字符串里的芯片型号
    const s2 = s
    params.push(s, s, s, s, s2)
  }

  if (status) {
    sql += ' AND status = ?'
    params.push(String(status))
  }

  sql += ' ORDER BY created_at DESC'

  const rows = db.prepare(sql).all(...params) as any[]
  return rows.map(parseBoardRow)
})
