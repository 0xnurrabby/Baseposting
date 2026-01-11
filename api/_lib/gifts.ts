import type { Redis } from '@upstash/redis'
import { getOrCreateUser, setUser } from './store.js'

export const GIFT_KEYS = {
  globalSeq: 'gift:global:seq',
  globalZ: 'gift:global:z', // ZSET member=giftId score=giftId
  globalKey: (giftId: number) => `gift:global:${giftId}`, // STRING(JSON)
  fidList: (fid: number) => `gift:fid:${fid}:l`, // LIST(JSON)
}

export type GiftRecord = {
  id: number
  amount: number
  message: string
  createdAt: number
  kind: 'global' | 'fid'
  // For fid gifts, who it was targeted to (helps UI)
  fid?: number
}

export type AppliedGifts = {
  applied: GiftRecord[]
  total: number
}

function safeInt(n: any, fallback = 0) {
  const x = Number(n)
  if (!Number.isFinite(x)) return fallback
  return Math.trunc(x)
}

export async function createGlobalGift(redis: Redis, amount: number, message: string) {
  const id = await redis.incr<number>(GIFT_KEYS.globalSeq)
  const rec: GiftRecord = {
    id,
    amount,
    message,
    createdAt: Date.now(),
    kind: 'global',
  }
  await redis.set(GIFT_KEYS.globalKey(id), JSON.stringify(rec))
  await redis.zadd(GIFT_KEYS.globalZ, { score: id, member: String(id) })
  return rec
}

export async function queueFidGift(redis: Redis, fid: number, amount: number, message: string) {
  const id = await redis.incr<number>(GIFT_KEYS.globalSeq)
  const rec: GiftRecord = {
    id,
    amount,
    message,
    createdAt: Date.now(),
    kind: 'fid',
    fid,
  }
  // Keep per-user gifts in a list so we can atomically consume them later.
  await redis.lpush(GIFT_KEYS.fidList(fid), JSON.stringify(rec))
  return rec
}

export async function applyPendingGifts(args: { redis: Redis | null; userId: string; fid?: number }) : Promise<AppliedGifts> {
  const { redis, userId, fid } = args
  if (!redis) return { applied: [], total: 0 }

  const applied: GiftRecord[] = []
  let total = 0

  // --- 1) Global gifts (idempotent using user.lastGlobalGiftId) ---
  const user = await getOrCreateUser(userId)

  // lastGlobalGiftId is stored in the user hash (default 0).
  const last = safeInt((user as any).lastGlobalGiftId, 0)

  let globalIds: string[] = []
  try {
    globalIds = await redis.zrangebyscore<string[]>(GIFT_KEYS.globalZ, last + 1, '+inf')
  } catch {
    globalIds = []
  }

  let maxApplied = last
  // Safety cap: don't apply an unbounded number of gifts in one request.
  for (const idRaw of globalIds.slice(0, 100)) {
    const id = safeInt(idRaw, 0)
    if (!id || id <= last) continue
    const raw = await redis.get<string | null>(GIFT_KEYS.globalKey(id))
    if (!raw) continue
    try {
      const rec = JSON.parse(String(raw)) as GiftRecord
      if (typeof rec?.amount === 'number' && Number.isFinite(rec.amount) && rec.amount !== 0) {
        total += rec.amount
        applied.push(rec)
        maxApplied = Math.max(maxApplied, id)
      }
    } catch {
      // ignore malformed gift
    }
  }

  // --- 2) Targeted gifts (consume-and-clear) ---
  if (Number.isFinite(fid)) {
    const key = GIFT_KEYS.fidList(Number(fid))
    let raws: any[] = []
    try {
      raws = await redis.lrange<any[]>(key, 0, -1)
      if (raws && raws.length) await redis.del(key)
    } catch {
      raws = []
    }

    for (const raw of raws.slice(0, 100)) {
      try {
        const rec = JSON.parse(String(raw)) as GiftRecord
        if (typeof rec?.amount === 'number' && Number.isFinite(rec.amount) && rec.amount !== 0) {
          total += rec.amount
          applied.push(rec)
        }
      } catch {
        // ignore malformed
      }
    }
  }

  if (total !== 0 || maxApplied !== last) {
    // Update credits + cursor in a single user update.
    ;(user as any).lastGlobalGiftId = maxApplied
    // adjustCredits uses getOrCreateUser internally, but we already have user; update directly to avoid extra roundtrip.
    user.credits = Math.max(0, user.credits + total)
    user.updatedAt = new Date().toISOString()
    await setUser(user as any)
  }

  return { applied, total }
}
