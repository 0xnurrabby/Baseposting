import { handleOptions, json, setCors } from './_lib/http.js'
import { getRewardAddresses, readLeaderboard, type LeaderboardEntry, type LeaderboardPeriod } from './_lib/leaderboard.js'

function pickPeriod(p: any): LeaderboardPeriod {
  const v = String(p || '').toLowerCase().trim()
  if (v === 'prev' || v === 'previous' || v === 'previous_week') return 'prev'
  return '7d'
}

async function fetchFarcasterUsersByFids(fids: number[]): Promise<Record<number, { displayName?: string; username?: string; pfpUrl?: string }>> {
  const apiKey = String(process.env.NEYNAR_API_KEY || '').trim()
  if (!apiKey) return {}
  if (!fids.length) return {}

  // Neynar bulk fetch (GET /v2/farcaster/user/bulk?fids=1,2,3)
  const url = `https://api.neynar.com/v2/farcaster/user/bulk?fids=${encodeURIComponent(fids.join(','))}`
  try {
    const r = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        Accept: 'application/json',
      },
    })
    if (!r.ok) return {}
    const data: any = await r.json()
    const users: any[] = Array.isArray(data?.users) ? data.users : []
    const out: Record<number, { displayName?: string; username?: string; pfpUrl?: string }> = {}
    for (const u of users) {
      const fid = Number(u?.fid)
      if (!Number.isFinite(fid)) continue
      out[fid] = {
        displayName: u?.display_name ? String(u.display_name) : (u?.displayName ? String(u.displayName) : undefined),
        username: u?.username ? String(u.username) : undefined,
        pfpUrl: u?.pfp_url ? String(u.pfp_url) : (u?.pfpUrl ? String(u.pfpUrl) : undefined),
      }
    }
    return out
  } catch {
    return {}
  }
}

export default async function handler(req: any, res: any) {
  setCors(req, res)
  if (handleOptions(req, res)) return

  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method Not Allowed' })
  }

  // Support both "period" and legacy "range" query param names.
  const qp =
    (req?.query && (req.query.period || req.query.p || req.query.range || req.query.r)) ||
    (req?.url ? new URL(req.url, 'http://x').searchParams.get('period') || new URL(req.url, 'http://x').searchParams.get('range') : '')
  const period = pickPeriod(qp)

  const { entries, meta } = await readLeaderboard(period)
  // Always use the latest submitted addresses (edits should reflect immediately).
  const addrMap = await getRewardAddresses(entries.map((e) => e.userId))
  const fids = entries.map((e) => e.fid).filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
  const profileMap = await fetchFarcasterUsersByFids(Array.from(new Set(fids)).slice(0, 100))

  const enriched: LeaderboardEntry[] = entries.map((e) => {
    const fid = e.fid
    const baseAddress = addrMap[e.userId] || e.baseAddress || null
    if (fid != null && profileMap[fid]) {
      const p = profileMap[fid]
      return { ...e, baseAddress, displayName: p.displayName, username: p.username, pfpUrl: p.pfpUrl }
    }
    return { ...e, baseAddress }
  })

  return json(res, 200, { ok: true, period, entries: enriched, meta })
}
