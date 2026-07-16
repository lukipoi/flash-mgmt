export interface Chip {
  id: number
  model: string
  jedec_id: string
  uid: string
  uid_length: number
  capacity: string | null
  page_size: number
  sec1_locked: number
  sec2_locked: number
  sec3_locked: number
  sec1_data: string | null
  sec2_data: string | null
  sec3_data: string | null
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

export interface Stats {
  total: number
  models: { model: string; count: number }[]
}
