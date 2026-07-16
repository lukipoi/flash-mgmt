import { db } from '../../database/init'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const { search, model } = query

  let sql = 'SELECT * FROM chips WHERE 1=1'
  const params: any[] = []

  if (search) {
    const s = `%${String(search)}%`
    sql += ' AND (model LIKE ? OR uid LIKE ? OR jedec_id LIKE ?)'
    params.push(s, s, s)
  }

  if (model) {
    sql += ' AND model = ?'
    params.push(String(model))
  }

  sql += ' ORDER BY created_at DESC'

  const stmt = db.prepare(sql)
  return stmt.all(...params)
})
