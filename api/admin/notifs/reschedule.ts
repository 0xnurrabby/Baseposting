import { getRedisClient } from '../../_lib/store.js'
import { handleOptions, json, readJson, requirePost, setCors } from '../../_lib/http.js'
import { requireBearer } from '../../_lib/auth.js'
import { rescheduleAll } from '../../_lib/notifications.js'

export default async function handler(req: any, res: any) {
  setCors(req, res)
  if (handleOptions(req, res)) return
  if (!requireBearer(req, res, 'CRON_SECRET')) return
  if (!requirePost(req, res)) return

  let body: any = {}
  try {
    body = await readJson(req)
  } catch {
    return json(res, 400, { ok: false, error: 'Invalid JSON body' })
  }

  const hours = Number(body?.hours)
  const redis = getRedisClient()
  if (!redis) return json(res, 500, { ok: false, error: 'Redis not configured' })

  try {
    const out = await rescheduleAll(redis, hours)
    return json(res, 200, { ok: true, ...out })
  } catch (e: any) {
    return json(res, 400, { ok: false, error: String(e?.message || e) })
  }
}
