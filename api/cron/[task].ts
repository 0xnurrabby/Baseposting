import crypto from 'crypto'
import { getRedisClient } from '../_lib/store.js'
import { requireBearer } from '../_lib/auth.js'
import { handleOptions, json, setCors } from '../_lib/http.js'
import { recomputeLeaderboards } from '../_lib/leaderboard.js'
import { NOTIF_KEYS, disableNotifications, getDueMembers, loadNotification, markSent, pushEvent } from '../_lib/notifications.js'

function getTask(req: any): string {
  const q = req?.query?.task
  if (Array.isArray(q)) return String(q[0] || '')
  if (typeof q === 'string') return q

  try {
    const u = new URL(req?.url || '', 'http://localhost')
    const parts = u.pathname.split('/').filter(Boolean)
    return String(parts[parts.length - 1] || '')
  } catch {
    return ''
  }
}

function stripTrailingSlash(url: string) {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

function appUrl() {
  const raw = process.env.NOTIF_APP_URL || process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://baseposting.online'
  return stripTrailingSlash(String(raw))
}

function buildPayload(now: number, fid: number, appFid: number, token: string) {
  const notificationId = crypto.randomUUID()
  return {
    notificationId,
    title: 'BasePosting',
    body: 'Just 2 clicks on BasePosting and you can keep your consistency 💙',
    targetUrl: `${appUrl()}/?src=notif&fid=${fid}&appFid=${appFid}&nid=${notificationId}`,
    tokens: [token],
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

  const task = getTask(req)

  // ---- leaderboard ----
  if (task === 'leaderboard') {
    try {
      const out = await recomputeLeaderboards()
      if (!out.ok) return json(res, 500, out)
      return json(res, 200, out)
    } catch (e: any) {
      return json(res, 500, { ok: false, error: String(e?.message || e || 'Failed') })
    }
  }

  // ---- notifications ----
  if (task === 'notifications') {
    const redis = getRedisClient()
    if (!redis) return json(res, 500, { ok: false, error: 'Redis not configured' })

    const now = Math.floor(Date.now() / 1000)
    const dueMembers = await getDueMembers(redis, now, 200)

    const due = dueMembers.length
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
        let parsed: any = null
        try {
          parsed = text ? JSON.parse(text) : null
        } catch {
          parsed = null
        }

        // Spec examples usually return { result: { successfulTokens, invalidTokens, rateLimitedTokens } }
        // Some implementations may return the arrays at the top-level.
        const result = parsed && typeof parsed === 'object' && 'result' in parsed ? (parsed as any).result : parsed
        const successfulTokens = Array.isArray(result?.successfulTokens) ? result.successfulTokens : []
        const invalidTokens = Array.isArray(result?.invalidTokens) ? result.invalidTokens : []
        const rateLimitedTokens = Array.isArray(result?.rateLimitedTokens) ? result.rateLimitedTokens : []

        results.push({
          member,
          status: resp.status,
          ok: resp.ok,
          successful: successfulTokens.length,
          invalid: invalidTokens.length,
          rateLimited: rateLimitedTokens.length,
          body: text?.slice(0, 300),
        })

        if (resp.ok) {
          if (invalidTokens.includes(rec.token)) {
            await disableNotifications(redis, rec.fid, rec.appFid)
          } else if (rateLimitedTokens.includes(rec.token)) {
            // retry soon; hosts typically enforce 1 notif / 30s / token
            const retryAt = now + 60
            await redis.set(
              NOTIF_KEYS.user(rec.fid, rec.appFid),
              JSON.stringify({ ...rec, nextSendAt: retryAt, updatedAt: now, lastError: 'rate_limited' })
            )
            await redis.zadd(NOTIF_KEYS.dueZ, { score: retryAt, member })
          } else {
            // success (or unknown response shape)
            await markSent(redis, rec, now)
            sent++
          }
        }
      } catch (e: any) {
        results.push({ member, ok: false, error: String(e?.message || e) })
      }
    }

    await pushEvent(redis, { ts: Date.now(), type: 'cron_run', data: { due, sent } })

    return json(res, 200, { ok: true, due, sent, results })
  }

  return json(res, 404, { ok: false, error: 'Not Found' })
}
