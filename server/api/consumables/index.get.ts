import { db } from '../../database/init'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const { search, status, location_a, location_b } = query

  let sql = 'SELECT * FROM consumables WHERE 1=1'
  const params: any[] = []

  if (search) {
    const s = `%${String(search)}%`
    sql += ' AND (brand LIKE ? OR model LIKE ? OR serial_number LIKE ? OR barcode LIKE ? OR note LIKE ? OR location_a LIKE ? OR location_b LIKE ? OR location_c LIKE ?)'
    params.push(s, s, s, s, s, s, s, s)
  }

  if (status) {
    sql += ' AND status = ?'
    params.push(String(status))
  }

  if (location_a) {
    sql += ' AND location_a = ?'
    params.push(String(location_a))
  }

  if (location_b) {
    sql += ' AND location_b = ?'
    params.push(String(location_b))
  }

  sql += ' ORDER BY created_at DESC'

  const stmt = db.prepare(sql)
  return stmt.all(...params)
})
