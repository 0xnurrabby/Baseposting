import './polyfill'
import { Redis } from '@upstash/redis'

export type UserRecord = {
  id: string
  credits: number
  lastShareAt?: string
  createdAt: string
  updatedAt: string
}

const memory = new Map<string, UserRecord>()
const memoryTx = new Set<string>()

function nowIso() {
  return new Date().toISOString()
}

function todayUtcDateKey() {
  const d = new Date()
  // Use UTC date to enforce the "once per day" share rule.
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
}
export async function getOrCreateUser(id: string): Promise<UserRecord> {
  const redis = getRedis()
  if (!redis) {
    const existing = memory.get(id)
    if (existing) return existing
    const rec: UserRecord = { id, credits: 10, createdAt: nowIso(), updatedAt: nowIso() }
    memory.set(id, rec)
    return rec
  }

  const key = `user:${id}`
  const data = await redis.hgetall<Record<string, string>>(key)
  if (!data || Object.keys(data).length === 0) {
    const created = nowIso()
    await redis.hset(key, {
      id,
      credits: '10',
      createdAt: created,
      updatedAt: created,
      lastShareAt: '',
    })
    return { id, credits: 10, createdAt: created, updatedAt: created }
  }

  return {
    id: data.id || id,
    credits: Number(data.credits || '0'),
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
  await redis.hset(key, {
    id: user.id,
    credits: String(user.credits),
    lastShareAt: user.lastShareAt || '',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  })
}

export async function adjustCredits(id: string, delta: number): Promise<UserRecord> {
  const user = await getOrCreateUser(id)
  user.credits = Math.max(0, user.credits + delta)
  user.updatedAt = nowIso()
  await setUser(user)
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
  const exists = await redis.get<number | null>(key)
  return Boolean(exists)
}

export async function markTxCounted(txHash: string): Promise<void> {
  const redis = getRedis()
  const key = `tx:${txHash.toLowerCase()}`
  if (!redis) {
    memoryTx.add(key)
    return
  }
  // Keep for 90 days.
  await redis.set(key, 1, { ex: 60 * 60 * 24 * 90 })
}
