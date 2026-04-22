import type { Redis } from '@upstash/redis'
import { getRedisClient } from './store.js'

export type LeaderboardPeriod = '7d' | 'prev'

export type LeaderboardEntry = {
  userId: string
  fid: number | null
  creditsSpent: number
  postCount: number
  photoCount: number
  displayName?: string
  username?: string
  pfpUrl?: string
  baseAddress?: string | null
  rewardUsd?: number | null
}

type DailyAgg = { creditsSpent: number; postCount: number; photoCount: number }

const LB_KEY_7D = 'leaderboard:7d'
const LB_KEY_PREV = 'leaderboard:prev'
const LB_META_KEY = 'leaderboard:meta'

const ADMIN_LB_7D = 'admin:leaderboard_7d'
const ADMIN_LB_PREV = 'admin:leaderboard_prev'

const DAILY_SPEND_PREFIX = 'daily:spend:'
const DAILY_POST_PREFIX = 'daily:post:'
const DAILY_PHOTO_PREFIX = 'daily:photo:'
const REWARD_ADDR_HASH = 'reward:addresses'
const FID_TO_ADDR_HASH = 'fid:to:address'

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

function startOfISOWeekUTC(d: Date): Date {
  const day = d.getUTCDay()
  const diffToMon = (day + 6) % 7
  return datePlusDays(d, -diffToMon)
}

function getRangeKeys(prefix: string, startInclusive: Date, days: number): string[] {
  const keys: string[] = []
  for (let i = 0; i < days; i++) {
    const day = datePlusDays(startInclusive, i)
    keys.push(prefix + utcDateKey(day))
  }
  return keys
}

async function hgetallNumberMap(redis: Redis, key: string): Promise<Record<string, number>> {
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

  try {
    if (spent > 0) await redis.hincrby(spendKey, userId, spent)
    if (post > 0) await redis.hincrby(postKey, userId, post)
    if (photo > 0) await redis.hincrby(photoKey, userId, photo)

    const ttl = 60 * 60 * 24 * 90
    await redis.expire(spendKey, ttl)
    await redis.expire(postKey, ttl)
    await redis.expire(photoKey, ttl)
  } catch {
    // ignore
  }
}

async function aggregateDays(redis: Redis, startInclusive: Date, days: number): Promise<Map<string, DailyAgg>> {
  const spendKeys = getRangeKeys(DAILY_SPEND_PREFIX, startInclusive, days)
  const postKeys = getRangeKeys(DAILY_POST_PREFIX, startInclusive, days)
  const photoKeys = getRangeKeys(DAILY_PHOTO_PREFIX, startInclusive, days)

  const agg = new Map<string, DailyAgg>()

  for (const k of spendKeys) {
    const map = await hgetallNumberMap(redis, k)
    for (const [userId, v] of Object.entries(map)) {
      const cur = agg.get(userId) || { creditsSpent: 0, postCount: 0, photoCount: 0 }
      cur.creditsSpent += v
      agg.set(userId, cur)
    }
  }

  for (const k of postKeys) {
    const map = await hgetallNumberMap(redis, k)
    for (const [userId, v] of Object.entries(map)) {
      const cur = agg.get(userId) || { creditsSpent: 0, postCount: 0, photoCount: 0 }
      cur.postCount += v
      agg.set(userId, cur)
    }
  }

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

async function getRewardAddressMap(redis: Redis): Promise<Record<string, string>> {
  try {
    const raw = await redis.hgetall<Record<string, string>>(REWARD_ADDR_HASH)
    return raw || {}
  } catch {
    return {}
  }
}

/**
 * Called when a wallet connects. If the same wallet previously used the app
 * via a Farcaster FID (and submitted their base address at that time), we
 * migrate their credits + leaderboard history + reward address from
 * `fid:N` → `addr:0x...`.
 *
 * Idempotent — safe to call on every /api/me.
 */
export async function migrateFidToAddressIfPossible(address: string): Promise<{ migrated: boolean; fromFid?: number }> {
  const redis = getRedisClient()
  if (!redis) return { migrated: false }

  const addrLower = String(address || '').toLowerCase()
  if (!/^0x[a-f0-9]{40}$/.test(addrLower)) return { migrated: false }

  const newUserId = `addr:${addrLower}`
  const newUserKey = `user:${newUserId}`

  try {
    // Find legacy fid for this address (user must have submitted reward
    // address while logged in with fid).
    const rewards = await getRewardAddressMap(redis)
    let legacyFidUserId: string | null = null
    for (const [uid, addr] of Object.entries(rewards)) {
      if (!uid.startsWith('fid:')) continue
      if (String(addr).toLowerCase() === addrLower) {
        legacyFidUserId = uid
        break
      }
    }

    if (!legacyFidUserId) return { migrated: false }

    // Skip if already migrated
    const migratedMark = await redis.hget(newUserKey, 'migratedFrom').catch(() => null)
    if (migratedMark && String(migratedMark) === legacyFidUserId) {
      return { migrated: false }
    }

    // 1) Merge credits + counters
    const legacyUserKey = `user:${legacyFidUserId}`
    const legacyData = (await redis.hgetall<Record<string, string>>(legacyUserKey)) || {}
    const legacyCredits = Number(legacyData.credits || '0')
    const legacyTx = Number(legacyData.txCount || '0')
    const legacyPost = Number(legacyData.postCount || '0')
    const legacyPhoto = Number(legacyData.photoCount || '0')

    if (legacyCredits > 0) {
      await redis.hincrby(newUserKey, 'credits', legacyCredits)
    }
    if (legacyTx > 0) await redis.hincrby(newUserKey, 'txCount', legacyTx)
    if (legacyPost > 0) await redis.hincrby(newUserKey, 'postCount', legacyPost)
    if (legacyPhoto > 0) await redis.hincrby(newUserKey, 'photoCount', legacyPhoto)

    const now = new Date().toISOString()
    await redis.hset(newUserKey, {
      id: newUserId,
      migratedFrom: legacyFidUserId,
      migratedAt: now,
      updatedAt: now,
    })

    // 2) Zero out legacy credits so they can't double-spend
    await redis.hset(legacyUserKey, {
      credits: '0',
      migratedTo: newUserId,
      updatedAt: now,
    })

    // 3) Migrate 30 days of daily leaderboard entries
    const today = new Date()
    for (let i = 0; i < 30; i++) {
      const day = datePlusDays(today, -i)
      const dayKey = utcDateKey(day)
      const keys = [DAILY_SPEND_PREFIX + dayKey, DAILY_POST_PREFIX + dayKey, DAILY_PHOTO_PREFIX + dayKey]
      for (const k of keys) {
        try {
          const v = await redis.hget<string | null>(k, legacyFidUserId)
          if (v != null) {
            const n = Number(v)
            if (Number.isFinite(n) && n > 0) {
              await redis.hincrby(k, newUserId, n)
            }
            await redis.hdel(k, legacyFidUserId)
          }
        } catch {
          // ignore
        }
      }
    }

    // 4) Move reward address entry
    try {
      await redis.hset(REWARD_ADDR_HASH, { [newUserId]: addrLower })
      await redis.hdel(REWARD_ADDR_HASH, legacyFidUserId)
    } catch {
      // ignore
    }

    // 5) Store fid->address hint
    const fid = parseFid(legacyFidUserId)
    if (fid != null) {
      try {
        await redis.hset(FID_TO_ADDR_HASH, { [String(fid)]: addrLower })
      } catch {
        // ignore
      }
    }

    // 6) Invalidate leaderboard cache so new layout is rebuilt
    try {
      await redis.del(LB_KEY_7D)
      await redis.del(LB_KEY_PREV)
      await redis.hdel(LB_META_KEY, 'updatedAt')
    } catch {
      // ignore
    }

    return { migrated: true, fromFid: fid ?? undefined }
  } catch {
    return { migrated: false }
  }
}

function toAdminLines(entries: LeaderboardEntry[], periodLabel: string) {
  const lines: string[] = []
  lines.push(`period: ${periodLabel}`)
  lines.push(`updated: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`)
  lines.push('')
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const who = e.fid != null ? `fid:${e.fid}` : e.userId
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

  const start7d = datePlusDays(today, -6)
  const startOfThisIsoWeek = startOfISOWeekUTC(today)
  const startPrev = datePlusDays(startOfThisIsoWeek, -7)
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

  const updatedAt = new Date().toISOString()
  await redis.set(LB_KEY_7D, JSON.stringify(top7d))
  await redis.set(LB_KEY_PREV, JSON.stringify(topPrev))
  await redis.hset(LB_META_KEY, {
    updatedAt,
    range7d: `${utcDateKey(start7d)}..${utcDateKey(today)}`,
    rangePrev: `${utcDateKey(startPrev)}..${utcDateKey(datePlusDays(startPrev, 6))}`,
  })

  await redis.set(ADMIN_LB_7D, toAdminLines(top7d, '7d'))
  await redis.set(ADMIN_LB_PREV, toAdminLines(topPrev, 'prev'))

  return { ok: true, updatedAt }
}

async function maybeRecomputeLeaderboards(redis: Redis, force: boolean): Promise<void> {
  if (!force) {
    try {
      const meta = await redis.hgetall<Record<string, any>>(LB_META_KEY)
      const updatedAt = meta?.updatedAt ? String(meta.updatedAt) : ''
      if (updatedAt) {
        const t = Date.parse(updatedAt)
        if (Number.isFinite(t) && Date.now() - t < 30_000) return
      }
    } catch {
      // ignore
    }
  }

  const lockKey = 'lb:recompute:lock'
  const lockVal = Math.random().toString(36).slice(2)
  let gotLock = false
  try {
    const res: any = await (redis as any).set(lockKey, lockVal, { nx: true, px: 30_000 })
    gotLock = !!res
    if (!gotLock) return

    await recomputeLeaderboards()
  } finally {
    if (gotLock) {
      try {
        const cur = await redis.get<string | null>(lockKey)
        if (cur === lockVal) await redis.del(lockKey)
      } catch {
        // ignore
      }
    }
  }
}

export async function readLeaderboard(period: LeaderboardPeriod, forceFresh = false): Promise<{ entries: LeaderboardEntry[]; meta: any }> {
  const redis = getRedisClient()
  if (!redis) return { entries: [], meta: { ok: false, error: 'Redis not configured' } }

  const key = period === 'prev' ? LB_KEY_PREV : LB_KEY_7D
  await maybeRecomputeLeaderboards(redis, forceFresh)

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
