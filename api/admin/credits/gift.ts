import { getRedisClient } from '../../_lib/store.js'
import { handleOptions, json, readJson, setCors } from '../../_lib/http.js'
import { requireBearer } from '../../_lib/auth.js'
import { createGlobalGift, queueFidGift } from '../../_lib/gifts.js'

function asNumberArray(x: any): number[] {
  if (!x) return []
  const arr = Array.isArray(x) ? x : [x]
  return arr
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Math.trunc(n))
}

export default async function handler(req: any, res: any) {
  setCors(req, res)
  if (handleOptions(req, res)) return
  if (!requireBearer(req, res, 'CRON_SECRET')) return

  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method Not Allowed' })

  const redis = getRedisClient()
  if (!redis) return json(res, 500, { ok: false, error: 'Redis not configured' })

  const body = await readJson(req).catch(() => ({}))

  const amount = Math.trunc(Number(body?.amount))
  if (!Number.isFinite(amount) || amount === 0) {
    return json(res, 400, { ok: false, error: 'Invalid amount (must be a non-zero number)' })
  }
  // Safety guard (avoid accidents)
  if (Math.abs(amount) > 100000) {
    return json(res, 400, { ok: false, error: 'Amount too large' })
  }

  const message = typeof body?.message === 'string' && body.message.trim() ? body.message.trim() : 'Gift credits'

  // If fids is missing or empty => GLOBAL gift
  const fids = asNumberArray(body?.fids)
  if (!fids.length) {
    const gift = await createGlobalGift(redis, amount, message)
    return json(res, 200, { ok: true, kind: 'global', gift })
  }

  // Targeted gifts (one or more FIDs)
  const gifts = []
  for (const fid of fids.slice(0, 5000)) {
    gifts.push(await queueFidGift(redis, fid, amount, message))
  }
  return json(res, 200, { ok: true, kind: 'fid', queued: gifts.length, sample: gifts.slice(0, 3) })
}
