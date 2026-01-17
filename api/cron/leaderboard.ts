import { handleOptions, json, setCors } from '../_lib/http.js'
import { requireBearer } from '../_lib/auth.js'
import { recomputeLeaderboards } from '../_lib/leaderboard.js'

// Recomputes Top-50 leaderboards (7d + previous week).
// Schedule this with QStash every 10 minutes.
export default async function handler(req: any, res: any) {
  setCors(req, res)
  if (handleOptions(req, res)) return

  // QStash should forward Authorization using Upstash-Forward-Authorization.
  if (!requireBearer(req, res, 'CRON_SECRET')) return

  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method Not Allowed' })
  }

  try {
    const out = await recomputeLeaderboards()
    if (!out.ok) return json(res, 500, out)
    return json(res, 200, out)
  } catch (e: any) {
    return json(res, 500, { ok: false, error: String(e?.message || e || 'Failed') })
  }
}
