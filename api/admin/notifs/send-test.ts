import crypto from 'crypto'
import { getRedisClient } from '../../_lib/store.js'
import { handleOptions, json, setCors } from '../../_lib/http.js'
import { requireBearer } from '../../_lib/auth.js'
import { loadNotification } from '../../_lib/notifications.js'

function appUrl() {
  const raw = process.env.NOTIF_APP_URL || process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://baseposting.online'
  return String(raw).replace(/\/+$/, '')
}

export default async function handler(req: any, res: any) {
  setCors(req, res)
  if (handleOptions(req, res)) return
  if (!requireBearer(req, res, 'CRON_SECRET')) return

  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method Not Allowed' })

  const redis = getRedisClient()
  if (!redis) return json(res, 500, { ok: false, error: 'Redis not configured' })

  const members = await redis.zrange('notif:due:z', 0, 0)
  if (!members || members.length === 0) return json(res, 404, { ok: false, error: 'No registered notification tokens yet' })

  const member = String(members[0])
  const rec = await loadNotification(redis, member)
  if (!rec) return json(res, 404, { ok: false, error: 'Invalid stored record' })

  const payload = {
    notificationId: crypto.randomUUID(),
    title: 'BasePosting',
    body: 'Just 2 clicks on BasePosting and you can keep your consistency 💙',
    targetUrl: appUrl(),
    tokens: [rec.token],
  }

  try {
    const resp = await fetch(rec.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const text = await resp.text().catch(() => '')
    return json(res, 200, { ok: resp.ok, status: resp.status, body: text?.slice(0, 500), member })
  } catch (e: any) {
    return json(res, 500, { ok: false, error: String(e?.message || e) })
  }
}
