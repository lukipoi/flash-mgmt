import { probeChipAsync } from '../utils/gyxs'

export default defineEventHandler(async () => {
  const result = await probeChipAsync()
  return result
})
