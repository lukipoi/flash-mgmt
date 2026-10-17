import { db } from '../../database/init'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const { search, model, chip_type, location_a, location_b } = query

  let sql = 'SELECT * FROM chips WHERE 1=1'
  const params: any[] = []

  if (search) {
    const s = `%${String(search)}%`
    sql += ' AND (vendor LIKE ? OR model LIKE ? OR uid LIKE ? OR jedec_id LIKE ? OR location_a LIKE ? OR location_b LIKE ? OR location_c LIKE ?)'
    params.push(s, s, s, s, s, s, s)
  }

  if (model) {
    sql += ' AND model = ?'
    params.push(String(model))
  }

  if (chip_type) {
    sql += ' AND chip_type = ?'
    params.push(String(chip_type))
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
