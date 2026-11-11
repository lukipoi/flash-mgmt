export type ChipType = 'flash' | 'mcu' | 'other'

export interface Chip {
  id: number
  vendor: string | null
  model: string
  chip_type: ChipType
  jedec_id: string
  uid: string | null
  uid_length: number
  capacity: string | null
  /** 列表接口附加：该型号是否已上传 Datasheet（server/api/chips index.get 计算） */
  has_ds?: boolean
  package: string | null
  /** 芯片类型（仅 chip_type = 'other' 使用，取自 chip_categories 列表） */
  chip_category: string | null
  /** 单包颗数：一袋几颗。仅 chip_type = 'other' 且未填 UID 时可 > 1，其余恒为 1 */
  qty_per_bag: number
  /** 原件照片文件名（chip-<id>.jpg；NULL = 没扫过，非强制） */
  photo: string | null
  page_size: number
  sec1_locked: number
  sec2_locked: number
  sec3_locked: number
  sec1_data: string | null
  sec2_data: string | null
  sec3_data: string | null
  location_a: string | null
  location_b: string | null
  location_c: string | null
  note: string | null
  created_at: string
  updated_at: string
}

export interface OperationLog {
  id: number
  chip_id: number
  operation: string
  detail: string | null
  file_path: string | null
  created_at: string
}

export interface ProbeResult {
  jedec_id: string
  uid: string
  uid_length: number
  sr1: string
  sr2: string
  model?: string
  error?: string
}

export type EquipmentStatus = 'normal' | 'damaged' | 'lost'

export interface Equipment {
  id: number
  brand: string | null
  model: string
  serial_number: string | null
  status: EquipmentStatus
  note: string | null
  created_at: string
  updated_at: string
}

export type ConsumableStatus = 'in_use' | 'in_stock'

export interface Consumable {
  id: number
  brand: string | null
  model: string
  serial_number: string | null
  barcode: string | null
  status: ConsumableStatus
  location_a: string | null
  location_b: string | null
  location_c: string | null
  shelf_life: string | null
  production_date: string | null
  expiry_date: string | null
  batch_number: string | null
  exec_standard: string | null
  net_content: string | null
  note: string | null
  created_at: string
  updated_at: string
}

export type CircuitBoardStatus = 'pending' | 'partial' | 'done'

export interface CircuitBoard {
  id: number
  brand: string | null
  model: string
  serial_number: string | null
  status: CircuitBoardStatus
  chips: string[] | null
  note: string | null
  created_at: string
  updated_at: string
}

export interface Stats {
  total: number
  models: { model: string; count: number; chip_type?: string }[]
  by_type?: { flash: number; mcu: number; other?: number }
  equipment_total?: number
  consumables_total?: number
  boards_total?: number
}
