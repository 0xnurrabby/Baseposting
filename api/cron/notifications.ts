import crypto from 'crypto'
import { getRedisClient } from '../_lib/store.js'
import { handleOptions, json, setCors } from '../_lib/http.js'
import { requireBearer } from '../_lib/auth.js'
import { getDueMembers, loadNotification, markSent, pushEvent } from '../_lib/notifications.js'

function stripTrailingSlash(url: string) {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

function appUrl() {
  const raw = process.env.NOTIF_APP_URL || process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://baseposting.online'
  return stripTrailingSlash(String(raw))
}

function buildPayload(now: number, fid: number, appFid: number, token: string) {
  return {
    notificationId: crypto.randomUUID(),
    title: 'BasePosting',
    body: 'Just 2 clicks on BasePosting and you can keep your consistency 💙',
    targetUrl: appUrl(),
    tokens: [token],
    data: { fid, appFid, ts: now },
  }
}

export default async function handler(req: any, res: any) {
  setCors(req, res)
  if (handleOptions(req, res)) return

  // QStash should forward Authorization using Upstash-Forward-Authorization.
  if (!requireBearer(req, res, 'CRON_SECRET')) return

  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method Not Allowed' })
  }

  const redis = getRedisClient()
  if (!redis) return json(res, 500, { ok: false, error: 'Redis not configured' })

  const now = Math.floor(Date.now() / 1000)
  const dueMembers = await getDueMembers(redis, now, 200)

  let due = dueMembers.length
  let sent = 0
  const results: any[] = []

  for (const member of dueMembers) {
    const rec = await loadNotification(redis, member)
    if (!rec) continue

    const payload = buildPayload(now, rec.fid, rec.appFid, rec.token)
    try {
      const resp = await fetch(rec.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const text = await resp.text().catch(() => '')

      results.push({ member, status: resp.status, ok: resp.ok, body: text?.slice(0, 300) })

      if (resp.ok) {
        await markSent(redis, rec, now)
        sent++
      }
    } catch (e: any) {
      results.push({ member, ok: false, error: String(e?.message || e) })
    }
  }

  await pushEvent(redis, { ts: Date.now(), type: 'cron_run', data: { due, sent } })

  return json(res, 200, { ok: true, due, sent, results })
}
