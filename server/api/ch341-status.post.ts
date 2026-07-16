import { checkCh341Status } from '../utils/gyxs'

export default defineEventHandler(async () => {
  return await checkCh341Status()
})
