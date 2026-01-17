import { handleOptions, json, setCors } from './_lib/http.js'
import {
  LB_KEYS,
  getRedisRaw,
  parseFidFromUserId,
  utcDateKeyFor,
  zrangeTopWithScores,
  zunionstoreSafe,
} from './_lib/store.js'

type Range = 'all' | '7d' | 'prevweek'

function pickRange(raw: any): Range {
  const r = String(raw || '').toLowerCase().trim()
  if (r === 'all' || r === 'alltime') return 'all'
  if (r === 'prev' || r === 'previous' || r === 'prevweek' || r === 'previousweek') return 'prevweek'
  return '7d'
}

function normalizeZsetPairs(arr: any[]): Array<{ member: string; score: number }> {
  const out: Array<{ member: string; score: number }> = []
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i]
    if (v && typeof v === 'object' && typeof v.member === 'string') {
      out.push({ member: v.member, score: Number(v.score || 0) })
      continue
    }
    if (typeof v === 'string') {
      const score = typeof arr[i + 1] === 'number' ? Number(arr[i + 1]) : Number(arr[i + 1] || 0)
      out.push({ member: v, score })
      if (typeof arr[i + 1] !== 'undefined') i++
    }
  }
  return out
}

function hubBaseUrl() {
  return String(process.env.FARCASTER_HUB_HTTP_URL || 'https://hub.farcaster.xyz').replace(/\/+$/, '')
}

function normalizeUrlMaybe(v: string) {
  const s = String(v || '').trim()
  if (!s) return ''
  // Some profiles use ipfs:// URIs for PFPs
  if (s.startsWith('ipfs://')) {
    return `https://ipfs.io/ipfs/${s.slice('ipfs://'.length)}`
  }
  // Avoid mixed-content issues inside https miniapps.
  if (s.startsWith('http://')) {
    return `https://${s.slice('http://'.length)}`
  }
  return s
}

function normalizeUserDataType(t: any): number {
  // Hub responses may return numeric enums or string enums.
  if (typeof t === 'number') return t
  const s = String(t || '').toUpperCase()
  if (s.includes('PFP')) return 1
  if (s.includes('DISPLAY')) return 2
  if (s.includes('USERNAME')) return 6
  return 0
}

async function fetchUserDataBundle(fid: number): Promise<{ pfpUrl: string; displayName: string; username: string }> {
  // Some hubs do not reliably support filtering by user_data_type query param.
  // Fetch all userData messages for the FID and extract the fields we need.
  const url = `${hubBaseUrl()}/v1/userDataByFid?fid=${encodeURIComponent(String(fid))}`
  const r = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'BasePosting/leaderboard',
    },
    cache: 'no-store' as any,
  })
  if (!r.ok) throw new Error(`Hub error: ${r.status}`)
  const data: any = await r.json()
  const msgs: any[] = Array.isArray(data?.messages) ? data.messages : []

  let pfpUrl = ''
  let displayName = ''
  let username = ''

  for (const m of msgs) {
    const body = m?.data?.userDataBody
    const typeNum = normalizeUserDataType(body?.type)
    const value = typeof body?.value === 'string' ? body.value : ''
    if (!value) continue
    if (typeNum === 1) pfpUrl = normalizeUrlMaybe(value)
    else if (typeNum === 2) displayName = value
    else if (typeNum === 6) username = value
  }

  return { pfpUrl, displayName, username }
}

async function getFarcasterProfile(fid: number) {
  const redis = await getRedisRaw()
  const cacheKey = LB_KEYS.fcProfile(fid)

  if (redis) {
    try {
      const cached = await redis.get<string | null>(cacheKey)
      if (cached) {
        const parsed = JSON.parse(cached)
        if (parsed && typeof parsed === 'object') {
          // If we previously cached an "empty" profile (hub hiccup), don't keep showing fid for 24h.
          const hasAny = Boolean(parsed?.username || parsed?.displayName || parsed?.pfpUrl)
          if (hasAny) return parsed
        }
      }
    } catch {
      // ignore
    }
  }

  const { pfpUrl, displayName, username } = await fetchUserDataBundle(fid).catch(() => ({ pfpUrl: '', displayName: '', username: '' }))

  const profile = {
    fid,
    username: username || null,
    displayName: displayName || null,
    pfpUrl: pfpUrl || null,
    updatedAt: new Date().toISOString(),
  }

  if (redis) {
    try {
      // Cache good profiles for 24h, but keep empty profiles short so they self-heal.
      const hasAny = Boolean(profile.username || profile.displayName || profile.pfpUrl)
      await redis.set(cacheKey, JSON.stringify(profile), { ex: hasAny ? 60 * 60 * 24 : 60 * 10 })
    } catch {
      // ignore
    }
  }

  return profile
}

function dayKeysFor(range: Exclude<Range, 'all'>) {
  const now = new Date()
  const keys: string[] = []
  const startOffset = range === '7d' ? 0 : 7
  for (let i = 0; i < 7; i++) {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() - (startOffset + i))
    const day = utcDateKeyFor(d)
    keys.push(LB_KEYS.daySpend(day))
  }
  return keys
}

async function maybeSyncRewardRanks(range: Exclude<Range, 'all'>, rows: Array<{ fid: number; rank: number; score: number; profile: any }>) {
  const redis = await getRedisRaw()
  if (!redis) return

  // Only touch users who have already submitted an address
  let submitted: string[] = []
  try {
    submitted = (await redis.smembers(LB_KEYS.rewardFids)) || []
  } catch {
    submitted = []
  }
  const submittedSet = new Set(submitted.map((x) => String(x)))
  if (submittedSet.size === 0) return

  const pipeline = redis.pipeline()
  for (const r of rows) {
    if (!submittedSet.has(String(r.fid))) continue
    const key = LB_KEYS.rewardRec(r.fid)
    const patch: Record<string, string> = {
      fid: String(r.fid),
      username: String(r.profile?.username || ''),
      displayName: String(r.profile?.displayName || ''),
      pfpUrl: String(r.profile?.pfpUrl || ''),
      updatedAt: new Date().toISOString(),
    }
    if (range === '7d') {
      patch.rank7d = String(r.rank)
      patch.spend7d = String(r.score)
    } else {
      patch.rankPrevWeek = String(r.rank)
      patch.spendPrevWeek = String(r.score)
    }
    pipeline.hset(key, patch)
  }
  try {
    await pipeline.exec()
  } catch {
    // ignore
  }
}

export default async function handler(req: any, res: any) {
  setCors(req, res)
  if (handleOptions(req, res)) return

  if (req.method !== 'GET') return json(res, 405, { error: 'Method Not Allowed' })

  const range = pickRange(req?.query?.range)
  const refresh = String(req?.query?.refresh || '').trim() === '1'
  const redis = await getRedisRaw()

  // Cached JSON snapshot (10 minutes) so it "updates every 10 minutes" by design.
  if (redis && !refresh) {
    try {
      const cached = await redis.get<string | null>(LB_KEYS.cacheJson(range))
      if (cached) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        return res.status(200).send(cached)
      }
    } catch {
      // ignore
    }
  }

  try {
    let pairs: Array<{ member: string; score: number }> = []

    if (range === 'all') {
      const raw = await zrangeTopWithScores(LB_KEYS.allTimeSpend, 50)
      pairs = normalizeZsetPairs(Array.isArray(raw) ? raw : [])
    } else {
      const sources = dayKeysFor(range)
      const dest = LB_KEYS.tmpUnion(range)
      await zunionstoreSafe(dest, sources)
      const raw = await zrangeTopWithScores(dest, 50)
      pairs = normalizeZsetPairs(Array.isArray(raw) ? raw : [])
    }

    const entries: any[] = []
    const syncRows: Array<{ fid: number; rank: number; score: number; profile: any }> = []

    for (let i = 0; i < pairs.length; i++) {
      const member = String(pairs[i].member)
      const score = Math.max(0, Number(pairs[i].score || 0))
      const fid = parseFidFromUserId(member)

      let profile: any = null
      if (fid != null) {
        profile = await getFarcasterProfile(fid).catch(() => null)
      }

      const name = profile?.displayName || profile?.username || member
      const username = profile?.username || null
      const pfpUrl = profile?.pfpUrl || null

      entries.push({
        rank: i + 1,
        fid: fid ?? null,
        member,
        name,
        username,
        pfpUrl,
        spentCredits: score,
      })

      if (fid != null && range !== 'all') {
        syncRows.push({ fid, rank: i + 1, score, profile })
      }
    }

    if (range !== 'all') {
      await maybeSyncRewardRanks(range, syncRows)
    }

    const payload = {
      ok: true,
      range,
      updatedAt: new Date().toISOString(),
      entries,
    }

    const rawJson = JSON.stringify(payload)

    if (redis) {
      try {
        await redis.set(LB_KEYS.cacheJson(range), rawJson, { ex: 60 * 10 })
      } catch {
        // ignore
      }
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).send(rawJson)
  } catch (e: any) {
    return json(res, 500, { error: e?.message || 'Leaderboard failed' })
  }
}
