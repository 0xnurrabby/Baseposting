import { getRedisClient } from '../../_lib/store.js'
import { handleOptions, json, setCors } from '../../_lib/http.js'
import { requireBearer } from '../../_lib/auth.js'
import { listEvents } from '../../_lib/notifications.js'

export default async function handler(req: any, res: any) {
  setCors(req, res)
  if (handleOptions(req, res)) return
  if (!requireBearer(req, res, 'CRON_SECRET')) return

  if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'Method Not Allowed' })

  const redis = getRedisClient()
  if (!redis) return json(res, 500, { ok: false, error: 'Redis not configured' })

  const limit = Math.min(200, Math.max(1, Number(req?.query?.limit || 50)))
  const events = await listEvents(redis, limit)
  return json(res, 200, { ok: true, events })
}
