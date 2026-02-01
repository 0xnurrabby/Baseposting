import crypto from 'crypto'
import { getRedisClient } from '../../_lib/store.js'
import { requireBearer } from '../../_lib/auth.js'
import { handleOptions, json, readJson, requirePost, setCors } from '../../_lib/http.js'
import { countRegistered, getDueMembers, listEvents, loadNotification, rescheduleAll, soonestNextSendAt } from '../../_lib/notifications.js'

function getAction(req: any): string {
  // In Vercel dynamic routes, the segment is usually available as req.query.action.
  const q = req?.query?.action
  if (Array.isArray(q)) return String(q[0] || '')
  if (typeof q === 'string') return q

  // Fallback: parse from URL
  try {
    const u = new URL(req?.url || '', 'http://localhost')
    const parts = u.pathname.split('/').filter(Boolean)
    return String(parts[parts.length - 1] || '')
  } catch {
    return ''
  }
}

function appUrl() {
  const raw = process.env.NOTIF_APP_URL || process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://baseposting.online'
  return String(raw).replace(/\/+$/, '')
}

export default async function handler(req: any, res: any) {
  setCors(req, res)
  if (handleOptions(req, res)) return
  if (!requireBearer(req, res, 'CRON_SECRET')) return

  const action = getAction(req)
  const redis = getRedisClient()
  if (!redis) return json(res, 500, { ok: false, error: 'Redis not configured' })

  // ---- status (GET) ----
  if (action === 'status') {
    if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'Method Not Allowed' })
    const now = Math.floor(Date.now() / 1000)
    const registered = await countRegistered(redis)
    const nextSendAt = await soonestNextSendAt(redis)
    const dueMembers = await getDueMembers(redis, now, 50)
    return json(res, 200, { ok: true, registered, dueNow: dueMembers.length, nextSendAt })
  }

  // ---- events (GET) ----
  if (action === 'events') {
    if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'Method Not Allowed' })
    const limit = Math.min(200, Math.max(1, Number(req?.query?.limit || 50)))
    const events = await listEvents(redis, limit)
    return json(res, 200, { ok: true, events })
  }

  // ---- send-test (POST) ----
  if (action === 'send-test') {
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method Not Allowed' })

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

  // ---- reschedule (POST) ----
  if (action === 'reschedule') {
    if (!requirePost(req, res)) return

    let body: any = {}
    try {
      body = await readJson(req)
    } catch {
      return json(res, 400, { ok: false, error: 'Invalid JSON body' })
    }

    const hours = Number(body?.hours)
    try {
      const out = await rescheduleAll(redis, hours)
      return json(res, 200, { ok: true, ...out })
    } catch (e: any) {
      return json(res, 400, { ok: false, error: String(e?.message || e) })
    }
  }

  return json(res, 404, { ok: false, error: 'Not Found' })
}
