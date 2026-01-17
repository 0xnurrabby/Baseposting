import { getRedisClient } from './store.js'

export type LeaderboardPeriod = '7d' | 'prev'

export type LeaderboardEntry = {
  userId: string
  fid: number | null
  creditsSpent: number
  postCount: number
  photoCount: number
  // Optional enrichment (filled by /api/leaderboard)
  displayName?: string
  username?: string
  pfpUrl?: string
  // Reward address
  baseAddress?: string | null
}

type DailyAgg = { creditsSpent: number; postCount: number; photoCount: number }

const LB_KEY_7D = 'leaderboard:7d'
const LB_KEY_PREV = 'leaderboard:prev'
const LB_META_KEY = 'leaderboard:meta'

// “Detabase” / Upstash Data Browser-friendly strings
const ADMIN_LB_7D = 'admin:leaderboard_7d'
const ADMIN_LB_PREV = 'admin:leaderboard_prev'

const DAILY_SPEND_PREFIX = 'daily:spend:'
const DAILY_POST_PREFIX = 'daily:post:'
const DAILY_PHOTO_PREFIX = 'daily:photo:'
const REWARD_ADDR_HASH = 'reward:addresses'

async function fetchNeynarProfilesByFids(fids: number[]): Promise<Record<number, { displayName?: string; username?: string; pfpUrl?: string }>> {
  const apiKey = String(process.env.NEYNAR_API_KEY || '').trim()
  if (!apiKey) return {}
  if (!fids.length) return {}

  const url = `https://api.neynar.com/v2/farcaster/user/bulk?fids=${encodeURIComponent(fids.join(','))}`
  try {
    const r = await fetch(url, {
      method: 'GET',
      headers: { 'x-api-key': apiKey, Accept: 'application/json' },
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

function parseFid(userId: string): number | null {
  if (!userId?.startsWith('fid:')) return null
  const n = Number(userId.slice(4))
  return Number.isFinite(n) ? n : null
}

function utcDateKey(d: Date): string {
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function datePlusDays(d: Date, deltaDays: number): Date {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() + deltaDays)
  return out
}

function getRangeKeys(prefix: string, startInclusive: Date, days: number): string[] {
  const keys: string[] = []
  for (let i = 0; i < days; i++) {
    const day = datePlusDays(startInclusive, i)
    keys.push(prefix + utcDateKey(day))
  }
  return keys
}

async function hgetallNumberMap(redis: any, key: string): Promise<Record<string, number>> {
  try {
    const raw = await redis.hgetall<Record<string, string>>(key)
    if (!raw) return {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(raw)) {
      const n = Number(v)
      if (Number.isFinite(n) && n !== 0) out[k] = n
    }
    return out
  } catch {
    return {}
  }
}

export async function logCreditSpend(args: { userId: string; creditsSpent: number; postDelta?: number; photoDelta?: number }) {
  const redis = getRedisClient()
  if (!redis) return

  const now = new Date()
  const dayKey = utcDateKey(now)
  const spendKey = DAILY_SPEND_PREFIX + dayKey
  const postKey = DAILY_POST_PREFIX + dayKey
  const photoKey = DAILY_PHOTO_PREFIX + dayKey

  const userId = args.userId
  const spent = Math.max(0, Number(args.creditsSpent || 0))
  const post = Math.max(0, Number(args.postDelta || 0))
  const photo = Math.max(0, Number(args.photoDelta || 0))

  // Best-effort: never break the main endpoint
  try {
    if (spent > 0) await redis.hincrby(spendKey, userId, spent)
    if (post > 0) await redis.hincrby(postKey, userId, post)
    if (photo > 0) await redis.hincrby(photoKey, userId, photo)

    // Keep ~90 days of daily keys.
    const ttl = 60 * 60 * 24 * 90
    await redis.expire(spendKey, ttl)
    await redis.expire(postKey, ttl)
    await redis.expire(photoKey, ttl)
  } catch {
    // ignore
  }
}

async function aggregateDays(redis: any, startInclusive: Date, days: number): Promise<Map<string, DailyAgg>> {
  const spendKeys = getRangeKeys(DAILY_SPEND_PREFIX, startInclusive, days)
  const postKeys = getRangeKeys(DAILY_POST_PREFIX, startInclusive, days)
  const photoKeys = getRangeKeys(DAILY_PHOTO_PREFIX, startInclusive, days)

  const agg = new Map<string, DailyAgg>()

  // Spend
  for (const k of spendKeys) {
    const map = await hgetallNumberMap(redis, k)
    for (const [userId, v] of Object.entries(map)) {
      const cur = agg.get(userId) || { creditsSpent: 0, postCount: 0, photoCount: 0 }
      cur.creditsSpent += v
      agg.set(userId, cur)
    }
  }

  // Posts
  for (const k of postKeys) {
    const map = await hgetallNumberMap(redis, k)
    for (const [userId, v] of Object.entries(map)) {
      const cur = agg.get(userId) || { creditsSpent: 0, postCount: 0, photoCount: 0 }
      cur.postCount += v
      agg.set(userId, cur)
    }
  }

  // Photos
  for (const k of photoKeys) {
    const map = await hgetallNumberMap(redis, k)
    for (const [userId, v] of Object.entries(map)) {
      const cur = agg.get(userId) || { creditsSpent: 0, postCount: 0, photoCount: 0 }
      cur.photoCount += v
      agg.set(userId, cur)
    }
  }

  return agg
}

async function getRewardAddressMap(redis: any): Promise<Record<string, string>> {
  try {
    const raw = await redis.hgetall<Record<string, string>>(REWARD_ADDR_HASH)
    return raw || {}
  } catch {
    return {}
  }
}

function toAdminLines(entries: LeaderboardEntry[], periodLabel: string) {
  const lines: string[] = []
  lines.push(`period: ${periodLabel}`)
  lines.push(`updated: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`)
  lines.push('')
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const label = e.displayName || (e.username ? `@${e.username}` : '')
    const who = e.fid != null ? `fid:${e.fid}${label ? ` (${label})` : ''}` : e.userId
    const addr = e.baseAddress ? ` | addr: ${e.baseAddress}` : ''
    lines.push(
      `${String(i + 1).padStart(2, '0')}. ${who} | spent: ${e.creditsSpent}c | post: ${e.postCount} | photo: ${e.photoCount}${addr}`
    )
  }
  return lines.join('\n')
}

export async function recomputeLeaderboards(): Promise<{ ok: boolean; updatedAt?: string; error?: string }> {
  const redis = getRedisClient()
  if (!redis) return { ok: false, error: 'Redis not configured' }

  const now = new Date()
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  // Last 7 days (inclusive): today-6 ... today
  const start7d = datePlusDays(today, -6)
  // Previous week (7 days): today-13 ... today-7
  const startPrev = datePlusDays(today, -13)

  const rewards = await getRewardAddressMap(redis)

  const build = async (start: Date, days: number): Promise<LeaderboardEntry[]> => {
    const agg = await aggregateDays(redis, start, days)

    const arr: LeaderboardEntry[] = []
    for (const [userId, v] of agg.entries()) {
      if (!v.creditsSpent) continue
      const fid = parseFid(userId)
      arr.push({
        userId,
        fid,
        creditsSpent: v.creditsSpent,
        postCount: v.postCount,
        photoCount: v.photoCount,
        baseAddress: rewards[userId] || null,
      })
    }

    arr.sort((a, b) => b.creditsSpent - a.creditsSpent)
    return arr.slice(0, 50)
  }

  const top7d = await build(start7d, 7)
  const topPrev = await build(startPrev, 7)

  // Enrich with Farcaster profile data so we don't show raw fid in UI/admin views.
  const allFids = Array.from(
    new Set([...top7d, ...topPrev].map((e) => e.fid).filter((x): x is number => typeof x === 'number' && Number.isFinite(x)))
  ).slice(0, 150)
  const profiles = await fetchNeynarProfilesByFids(allFids)

  const applyProfiles = (arr: LeaderboardEntry[]) =>
    arr.map((e) => {
      if (e.fid != null && profiles[e.fid]) {
        const p = profiles[e.fid]
        return { ...e, displayName: p.displayName, username: p.username, pfpUrl: p.pfpUrl }
      }
      return e
    })

  const top7dEnriched = applyProfiles(top7d)
  const topPrevEnriched = applyProfiles(topPrev)

  const updatedAt = new Date().toISOString()
  await redis.set(LB_KEY_7D, JSON.stringify(top7dEnriched))
  await redis.set(LB_KEY_PREV, JSON.stringify(topPrevEnriched))
  await redis.hset(LB_META_KEY, {
    updatedAt,
    // helpful for debugging
    range7d: `${utcDateKey(start7d)}..${utcDateKey(today)}`,
    rangePrev: `${utcDateKey(startPrev)}..${utcDateKey(datePlusDays(today, -7))}`,
  })

  // Data-browser friendly strings
  await redis.set(ADMIN_LB_7D, toAdminLines(top7dEnriched, '7d'))
  await redis.set(ADMIN_LB_PREV, toAdminLines(topPrevEnriched, 'prev'))

  return { ok: true, updatedAt }
}

export async function readLeaderboard(period: LeaderboardPeriod): Promise<{ entries: LeaderboardEntry[]; meta: any }> {
  const redis = getRedisClient()
  if (!redis) return { entries: [], meta: { ok: false, error: 'Redis not configured' } }

  const key = period === 'prev' ? LB_KEY_PREV : LB_KEY_7D
  let entries: LeaderboardEntry[] = []
  try {
    const raw = await redis.get<string | null>(key)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) entries = parsed as LeaderboardEntry[]
    }
  } catch {
    // ignore
  }

  // Fallback: if JSON keys are missing (older deployments) but admin strings exist,
  // parse the admin leaderboard text so the miniapp can still show data.
  if (entries.length === 0) {
    const adminKey = period === 'prev' ? ADMIN_LB_PREV : ADMIN_LB_7D
    try {
      const rawAdmin = await redis.get<string | null>(adminKey)
      if (rawAdmin) {
        const out: LeaderboardEntry[] = []
        for (const line of rawAdmin.split(/\r?\n/)) {
          // Example: "01. fid:1407742 (Nur) | spent: 12c | post: 2 | photo: 2 | addr: 0x..."
          const m = line.match(/^\s*\d+\.\s+(.+)$/)
          if (!m) continue
          const body = m[1]
          const fidMatch = body.match(/fid:(\d+)/)
          if (!fidMatch) continue
          const fid = Number(fidMatch[1])
          if (!Number.isFinite(fid)) continue

          const spentMatch = body.match(/spent:\s*(\d+)c/i)
          const postMatch = body.match(/post:\s*(\d+)/i)
          const photoMatch = body.match(/photo:\s*(\d+)/i)
          const addrMatch = body.match(/addr:\s*(0x[a-fA-F0-9]{40})/)

          const creditsSpent = spentMatch ? Number(spentMatch[1]) : 0
          const postCount = postMatch ? Number(postMatch[1]) : 0
          const photoCount = photoMatch ? Number(photoMatch[1]) : 0
          const baseAddress = addrMatch ? addrMatch[1] : null

          out.push({
            userId: `fid:${fid}`,
            fid,
            creditsSpent: Number.isFinite(creditsSpent) ? creditsSpent : 0,
            postCount: Number.isFinite(postCount) ? postCount : 0,
            photoCount: Number.isFinite(photoCount) ? photoCount : 0,
            baseAddress,
          })
        }

        out.sort((a, b) => b.creditsSpent - a.creditsSpent)
        entries = out.slice(0, 50)
      }
    } catch {
      // ignore
    }
  }

  let meta: any = {}
  try {
    meta = (await redis.hgetall<Record<string, string>>(LB_META_KEY)) || {}
  } catch {
    meta = {}
  }

  return { entries, meta }
}

export async function getRewardAddress(userId: string): Promise<string | null> {
  const redis = getRedisClient()
  if (!redis) return null
  try {
    const v = await redis.hget<string | null>(REWARD_ADDR_HASH, userId)
    return v || null
  } catch {
    return null
  }
}

export async function getRewardAddresses(userIds: string[]): Promise<Record<string, string>> {
  const redis = getRedisClient()
  if (!redis) return {}
  const set = new Set(userIds.filter(Boolean))
  if (set.size === 0) return {}
  // Fast path: fetch entire hash once; small enough for this use case.
  try {
    const raw = await redis.hgetall<Record<string, string>>(REWARD_ADDR_HASH)
    const out: Record<string, string> = {}
    if (raw) {
      for (const id of set) {
        if (raw[id]) out[id] = raw[id]
      }
    }
    return out
  } catch {
    return {}
  }
}

export async function setRewardAddress(userId: string, address: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  await redis.hset(REWARD_ADDR_HASH, { [userId]: address })
}
