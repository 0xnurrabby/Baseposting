import { getRedisClient } from '../../_lib/store.js'
import { handleOptions, json, setCors } from '../../_lib/http.js'
import { requireBearer } from '../../_lib/auth.js'
import { countRegistered, getDueMembers, soonestNextSendAt } from '../../_lib/notifications.js'

export default async function handler(req: any, res: any) {
  setCors(req, res)
  if (handleOptions(req, res)) return
  if (!requireBearer(req, res, 'CRON_SECRET')) return

  if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'Method Not Allowed' })

  const redis = getRedisClient()
  if (!redis) return json(res, 500, { ok: false, error: 'Redis not configured' })

  const now = Math.floor(Date.now() / 1000)
  const registered = await countRegistered(redis)
  const nextSendAt = await soonestNextSendAt(redis)
  const dueMembers = await getDueMembers(redis, now, 50)

  return json(res, 200, { ok: true, registered, dueNow: dueMembers.length, nextSendAt })
}
