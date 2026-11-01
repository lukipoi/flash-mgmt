import { db } from '../../database/init'
import { normalizeVendorDb } from '../../utils/vendorNormalize'
import { normalizePackageDb } from '../../utils/packageNormalize'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const { search, model, chip_type, location_a, location_b, vendor, package: pkg } = query

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

  // 厂商筛选：lower() 归一匹配，兼容历史数据大小写混用（SQLite lower 只处理 ASCII，对中文品牌无影响）
  if (vendor) {
    sql += ' AND lower(vendor) = lower(?)'
    params.push(normalizeVendorDb(String(vendor)))
  }

  // 封装筛选：同厂商筛选模式，lower() 归一匹配
  if (pkg) {
    sql += ' AND lower(package) = lower(?)'
    params.push(normalizePackageDb(String(pkg)))
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
