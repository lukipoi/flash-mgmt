import { db } from '../../database/init'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const { search, status } = query

  let sql = 'SELECT * FROM equipment WHERE 1=1'
  const params: any[] = []

  if (search) {
    const s = `%${String(search)}%`
    sql += ' AND (brand LIKE ? OR model LIKE ? OR serial_number LIKE ? OR note LIKE ?)'
    params.push(s, s, s, s)
  }

  if (status) {
    sql += ' AND status = ?'
    params.push(String(status))
  }

  sql += ' ORDER BY created_at DESC'

  const stmt = db.prepare(sql)
  return stmt.all(...params)
})
