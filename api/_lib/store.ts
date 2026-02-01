import { Redis } from '@upstash/redis'

export type UserRecord = {
  id: string
  credits: number
  // Engagement metrics (best-effort)
  txCount?: number
  photoCount?: number
  postCount?: number
  lastShareAt?: string
  createdAt: string
  updatedAt: string
}

const memory = new Map<string, UserRecord>()
const memoryTx = new Set<string>()

// Best-effort recent history (used to diversify post generation).
// - In production (Upstash) this is stored in Redis lists.
// - In local/dev/no-redis we keep a small in-memory buffer.
const memoryRecent = new Map<string, any[]>()

type MetricKey = 'txCount' | 'photoCount' | 'postCount'

const SUMMARY_NEW_KEY = 'admin:new_users'
const SUMMARY_ACTIVE_KEY = 'admin:most_active'
const ZSET_NEW_USERS = 'users:new'
const ZSET_ACTIVE_USERS = 'users:active'

function parseFid(id: string) {
  if (id.startsWith('fid:')) {
    const n = Number(id.slice(4))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function nowIso() {
  return new Date().toISOString()
}

function getOrCreateUserMemory(id: string): UserRecord {
  const existing = memory.get(id)
  if (existing) return existing
  const rec: UserRecord = {
    id,
    credits: 10,
    txCount: 0,
    photoCount: 0,
    postCount: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  memory.set(id, rec)
  return rec
}

async function withRedis<T>(fn: (redis: Redis) => Promise<T>, fallback: T): Promise<T> {
  const redis = getRedis()
  if (!redis) return fallback
  try {
    return await fn(redis)
  } catch {
    return fallback
  }
}

function todayUtcDateKey() {
  const d = new Date()
  // Use UTC date to enforce the "once per day" share rule.
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function getRedis(): Redis | null {
  const urlRaw = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
  const tokenRaw = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
  const url = typeof urlRaw === 'string' ? urlRaw.trim() : ''
  const token = typeof tokenRaw === 'string' ? tokenRaw.trim() : ''
  if (!url || !token) return null
  try {
    return new Redis({ url, token })
  } catch {
    // If env values are malformed, never crash the function.
    return null
  }
}

// Expose for other serverless endpoints (e.g. notifications) to reuse the same Upstash config.
export function getRedisClient() {
  return getRedis()
}

export async function getOrCreateUser(id: string): Promise<UserRecord> {
  const redis = getRedis()
  if (!redis) {
    return getOrCreateUserMemory(id)
  }

  const key = `user:${id}`
  let data: Record<string, string> | null = null
  try {
    data = await redis.hgetall<Record<string, string>>(key)
  } catch {
    // If Redis is flaky, fall back to memory so functions never crash.
    return getOrCreateUserMemory(id)
  }

  if (!data || Object.keys(data).length === 0) {
    const created = nowIso()
    try {
      await redis.hset(key, {
        id,
        credits: '10',
        txCount: '0',
        photoCount: '0',
        postCount: '0',
        createdAt: created,
        updatedAt: created,
        lastShareAt: '',
      })

      // Track new/active users (best-effort)
      try {
        const ts = Date.now()
        await redis.zadd(ZSET_NEW_USERS, { score: ts, member: id })
        await redis.zadd(ZSET_ACTIVE_USERS, { score: 0, member: id })
        await rebuildAdminSummaries(redis)
      } catch {
        // ignore
      }
    } catch {
      return getOrCreateUserMemory(id)
    }

    return { id, credits: 10, createdAt: created, updatedAt: created }
  }

  return {
    id: data.id || id,
    credits: Number(data.credits || '0'),
    txCount: Number(data.txCount || '0'),
    photoCount: Number(data.photoCount || '0'),
    postCount: Number(data.postCount || '0'),
    lastShareAt: data.lastShareAt || undefined,
    createdAt: data.createdAt || nowIso(),
    updatedAt: data.updatedAt || nowIso(),
  }
}

export async function setUser(user: UserRecord): Promise<void> {
  const redis = getRedis()
  if (!redis) {
    memory.set(user.id, user)
    return
  }

  const key = `user:${user.id}`
  try {
    await redis.hset(key, {
      id: user.id,
      credits: String(user.credits),
      txCount: String(user.txCount ?? 0),
      photoCount: String(user.photoCount ?? 0),
      postCount: String(user.postCount ?? 0),
      lastShareAt: user.lastShareAt || '',
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    })
  } catch {
    // Never crash if Redis is down.
    memory.set(user.id, user)
  }
}

function formatLine(u: UserRecord) {
  const fid = parseFid(u.id)
  const joined = u.createdAt ? u.createdAt.slice(0, 19).replace('T', ' ') : ''
  const tx = u.txCount ?? 0
  const photo = u.photoCount ?? 0
  const post = u.postCount ?? 0
  const credits = u.credits ?? 0
  const who = fid != null ? `fid:${fid}` : u.id
  return `${who} | joined: ${joined} | tx: ${tx} | credits: ${credits} | photo: ${photo} | post: ${post}`
}

async function zrangeWithScores(redis: any, key: string, start: number, stop: number, rev: boolean) {
  // Upstash supports options-based zrange. We keep a fallback for older servers.
  try {
    return await redis.zrange(key, start, stop, { rev, withScores: true })
  } catch {
    // fallback: zrevrange with WITHSCORES
    if (rev && typeof redis.zrevrange === 'function') {
      try {
        return await redis.zrevrange(key, start, stop, { withScores: true })
      } catch {
        // ignore
      }
    }
    return []
  }
}

async function rebuildAdminSummaries(redis: any) {
  const limit = 50

  const extractMembers = (arr: any[]): string[] => {
    const out: string[] = []
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i]
      if (typeof v === 'string') {
        // If the next element is a number (WITHSCORES alternating array), skip it.
        out.push(v)
        if (typeof arr[i + 1] === 'number') i++
        continue
      }
      if (v && typeof v === 'object' && typeof v.member === 'string') {
        out.push(v.member)
      }
    }
    return out
  }

  // New users: newest first
  const newest = await zrangeWithScores(redis, ZSET_NEW_USERS, 0, limit - 1, true)
  const newIds = Array.isArray(newest) ? extractMembers(newest) : []

  // Most active: highest score first
  const active = await zrangeWithScores(redis, ZSET_ACTIVE_USERS, 0, limit - 1, true)
  const activeIds = Array.isArray(active) ? extractMembers(active) : []

  const fetchUser = async (id: string): Promise<UserRecord | null> => {
    try {
      const data = await redis.hgetall<Record<string, string>>(`user:${id}`)
      if (!data || Object.keys(data).length === 0) return null
      return {
        id: data.id || id,
        credits: Number(data.credits || '0'),
        txCount: Number(data.txCount || '0'),
        photoCount: Number(data.photoCount || '0'),
        postCount: Number(data.postCount || '0'),
        lastShareAt: data.lastShareAt || undefined,
        createdAt: data.createdAt || nowIso(),
        updatedAt: data.updatedAt || nowIso(),
      }
    } catch {
      return null
    }
  }

  const newLines: string[] = []
  for (const id of newIds) {
    const u = await fetchUser(String(id))
    if (u) newLines.push(formatLine(u))
  }

  const activeLines: string[] = []
  for (const id of activeIds) {
    const u = await fetchUser(String(id))
    if (u) activeLines.push(formatLine(u))
  }

  // Single "box" style strings for Upstash Data Browser
  await redis.set(SUMMARY_NEW_KEY, newLines.join('\n'))
  await redis.set(SUMMARY_ACTIVE_KEY, activeLines.join('\n'))
}

export async function incrementMetric(id: string, metric: MetricKey, delta: number, activeDelta = 1) {
  const redis = getRedis()
  if (!redis) {
    const u = await getOrCreateUser(id)
    ;(u as any)[metric] = Math.max(0, Number((u as any)[metric] || 0) + delta)
    u.updatedAt = nowIso()
    memory.set(id, u)
    return u
  }

  const key = `user:${id}`
  // Keep user record up-to-date
  await redis.hincrby(key, metric, delta)
  await redis.hset(key, { updatedAt: nowIso() })

  // Ensure membership in the scoreboards
  try {
    const existing = await redis.zscore(ZSET_NEW_USERS, id)
    if (existing == null) {
      await redis.zadd(ZSET_NEW_USERS, { score: Date.now(), member: id })
    }
  } catch {
    // ignore
  }

  // Activity scoreboard: increment score
  try {
    await redis.zincrby(ZSET_ACTIVE_USERS, activeDelta, id)
  } catch {
    // Some Upstash versions don't expose zincrby; fallback by reading + zadd
    try {
      const cur = (await redis.zscore(ZSET_ACTIVE_USERS, id)) ?? 0
      await redis.zadd(ZSET_ACTIVE_USERS, { score: Number(cur) + activeDelta, member: id })
    } catch {
      // ignore
    }
  }

  // Refresh summaries so the Data Browser shows the latest (best-effort).
  try {
    await rebuildAdminSummaries(redis)
  } catch {
    // ignore
  }

  return await getOrCreateUser(id)
}

export async function adjustCredits(id: string, delta: number): Promise<UserRecord> {
  const user = await getOrCreateUser(id)
  user.credits = Math.max(0, user.credits + delta)
  user.updatedAt = nowIso()
  await setUser(user)

  // Keep admin summary strings reasonably fresh (best-effort).
  const redis = getRedis()
  if (redis) {
    try { await rebuildAdminSummaries(redis) } catch { /* ignore */ }
  }
  return user
}

export async function canClaimShareBonus(id: string): Promise<{ ok: boolean; today: string }> {
  const today = todayUtcDateKey()
  const user = await getOrCreateUser(id)
  const last = user.lastShareAt || ''
  if (last === today) return { ok: false, today }
  return { ok: true, today }
}

export async function markShareClaimed(id: string): Promise<UserRecord> {
  const today = todayUtcDateKey()
  const user = await getOrCreateUser(id)
  user.lastShareAt = today
  user.updatedAt = nowIso()
  await setUser(user)
  return user
}

export async function txAlreadyCounted(txHash: string): Promise<boolean> {
  const redis = getRedis()
  const key = `tx:${txHash.toLowerCase()}`
  if (!redis) return memoryTx.has(key)
  let exists: number | null = null
  try { exists = await redis.get<number | null>(key) } catch { exists = null }
  return Boolean(exists)
}

export async function markTxCounted(txHash: string): Promise<void> {
  const redis = getRedis()
  const key = `tx:${txHash.toLowerCase()}`
  if (!redis) {
    memoryTx.add(key)
    return
  }
  try {
    // Keep for 90 days.
    await redis.set(key, 1, { ex: 60 * 60 * 24 * 90 })
  } catch {
    memoryTx.add(key)
  }
}


// ---------------------------------------------------------------------------
// Recent generation history (post diversity)
// ---------------------------------------------------------------------------

function recentKey(kind: string, userId: string) {
  const safeKind = String(kind || 'post').toLowerCase().replace(/[^a-z0-9_\-:]/g, '_')
  return `recent:${safeKind}:${userId}`
}

export async function getRecent(userId: string, kind: string, limit = 12): Promise<any[]> {
  const redis = getRedis()
  const key = recentKey(kind, userId)
  const n = Math.max(0, Math.min(50, Number(limit) || 12))

  if (!redis) {
    const arr = memoryRecent.get(key) || []
    return arr.slice(0, n)
  }

  try {
    const raw = await redis.lrange<string[]>(key, 0, n - 1)
    const out: any[] = []
    for (const s of raw || []) {
      try {
        out.push(JSON.parse(String(s)))
      } catch {
        // ignore malformed
      }
    }
    return out
  } catch {
    return []
  }
}

export async function pushRecent(userId: string, kind: string, value: any, maxLen = 12): Promise<void> {
  const redis = getRedis()
  const key = recentKey(kind, userId)
  const cap = Math.max(1, Math.min(50, Number(maxLen) || 12))
  const payload = JSON.stringify(value ?? {})

  if (!redis) {
    const arr = memoryRecent.get(key) || []
    arr.unshift(value)
    memoryRecent.set(key, arr.slice(0, cap))
    return
  }

  try {
    await redis.lpush(key, payload)
    await redis.ltrim(key, 0, cap - 1)
    // Keep for 30 days so history doesn't grow unbounded.
    await redis.expire(key, 60 * 60 * 24 * 30)
  } catch {
    // ignore
  }
}
