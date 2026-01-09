import type { Redis } from '@upstash/redis'

export const NOTIF_KEYS = {
  dueZ: 'notif:due:z', // ZSET member="fid:appFid" score=nextSendAt (unix seconds)
  user: (fid: number, appFid: number) => `notif:user:${fid}:${appFid}`,
  events: 'notif:events:l',
}

export type NotifRecord = {
  fid: number
  appFid: number

  // push routing (from webhook)
  token: string
  url: string

  // scheduling
  cadenceHours: number
  nextSendAt: number

  // analytics / state (optional for backward-compat)
  enabled?: boolean
  enabledAt?: number
  disabledAt?: number
  updatedAt?: number

  sentCount?: number
  lastSentAt?: number

  openedCount?: number
  lastOpenedAt?: number

  lastError?: string
}

export type WebhookEventLog = {
  ts: number
  type: string
  data: any
}

const DEFAULT_CADENCE_HOURS = 2

export function cadenceHours() {
  const raw = Number(process.env.NOTIF_CADENCE_HOURS ?? DEFAULT_CADENCE_HOURS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CADENCE_HOURS
}

export function memberId(fid: number, appFid: number) {
  return `${fid}:${appFid}`
}

export async function pushEvent(redis: Redis, evt: WebhookEventLog) {
  await redis.lpush(NOTIF_KEYS.events, JSON.stringify(evt))
  await redis.ltrim(NOTIF_KEYS.events, 0, 199)
}

function normalizeRecord(rec: NotifRecord): NotifRecord {
  // Backward compatible defaults
  if (rec.enabled === undefined) rec.enabled = true
  if (rec.sentCount === undefined) rec.sentCount = 0
  if (rec.openedCount === undefined) rec.openedCount = 0
  return rec
}

export async function upsertNotificationDetails(
  redis: Redis,
  fid: number,
  appFid: number,
  details: { token: string; url: string },
) {
  const now = Math.floor(Date.now() / 1000)
  const cadence = cadenceHours()
  const member = memberId(fid, appFid)

  const existing = await loadNotification(redis, member)
  const nextSendAt = now + cadence * 60 * 60

  const rec: NotifRecord = normalizeRecord({
    ...(existing ?? ({} as any)),
    fid,
    appFid,
    token: details.token,
    url: details.url,
    cadenceHours: cadence,
    nextSendAt,
    enabled: true,
    enabledAt: existing?.enabledAt ?? now,
    disabledAt: undefined,
    updatedAt: now,
  })

  await redis.set(NOTIF_KEYS.user(fid, appFid), JSON.stringify(rec))
  await redis.zadd(NOTIF_KEYS.dueZ, { score: rec.nextSendAt, member })

  return rec
}

export async function disableNotifications(redis: Redis, fid: number, appFid: number) {
  const now = Math.floor(Date.now() / 1000)
  const member = memberId(fid, appFid)

  const existing = await loadNotification(redis, member)
  if (existing) {
    const rec: NotifRecord = normalizeRecord({
      ...existing,
      enabled: false,
      disabledAt: now,
      updatedAt: now,
    })
    await redis.set(NOTIF_KEYS.user(fid, appFid), JSON.stringify(rec))
  }

  // Always remove from schedule
  await redis.zrem(NOTIF_KEYS.dueZ, member)
}

export async function loadNotification(redis: Redis, member: string) {
  const [fidStr, appFidStr] = member.split(':')
  const fid = Number(fidStr)
  const appFid = Number(appFidStr)
  if (!Number.isFinite(fid) || !Number.isFinite(appFid)) return null
  const raw = await redis.get(NOTIF_KEYS.user(fid, appFid))
  if (!raw) return null
  try {
    const parsed = JSON.parse(String(raw)) as NotifRecord
    return normalizeRecord(parsed)
  } catch {
    return null
  }
}

export async function markSent(redis: Redis, rec: NotifRecord, now: number) {
  const next = now + rec.cadenceHours * 60 * 60
  const updated: NotifRecord = normalizeRecord({
    ...rec,
    nextSendAt: next,
    sentCount: (rec.sentCount ?? 0) + 1,
    lastSentAt: now,
    updatedAt: now,
    lastError: undefined,
  })
  await redis.set(NOTIF_KEYS.user(rec.fid, rec.appFid), JSON.stringify(updated))
  await redis.zadd(NOTIF_KEYS.dueZ, { score: next, member: memberId(rec.fid, rec.appFid) })
  return updated
}

export async function markOpened(redis: Redis, fid: number, appFid: number, now: number, meta?: any) {
  const member = memberId(fid, appFid)
  const rec = await loadNotification(redis, member)
  if (!rec) return null

  const updated: NotifRecord = normalizeRecord({
    ...rec,
    openedCount: (rec.openedCount ?? 0) + 1,
    lastOpenedAt: now,
    updatedAt: now,
  })

  await redis.set(NOTIF_KEYS.user(fid, appFid), JSON.stringify(updated))
  await pushEvent(redis, { ts: Date.now(), type: 'notification_opened', data: { fid, appFid, ...(meta ?? {}) } })

  return updated
}

/**
 * Best-effort fetch of due members.
 * Upstash's ZRANGE options have changed across versions, so we implement a safe fallback.
 */
export async function getDueMembers(redis: Redis, now: number, maxScan: number = 200) {
  // Fast path: byScore if supported by the client
  try {
    // @ts-ignore - byScore is supported in newer @upstash/redis
    const members = await redis.zrange(NOTIF_KEYS.dueZ, 0, now, { byScore: true, offset: 0, count: maxScan })
    // Filter disabled records (in case schedule wasn't cleaned)
    const out: string[] = []
    for (const m of members) {
      const member = String(m)
      const rec = await loadNotification(redis, member)
      if (rec?.enabled === false) continue
      out.push(member)
    }
    return out
  } catch {
    // Fallback: grab the earliest N scheduled and filter by nextSendAt stored in the record.
    const earliest = await redis.zrange(NOTIF_KEYS.dueZ, 0, maxScan - 1)
    const due: string[] = []
    for (const m of earliest) {
      const member = String(m)
      const rec = await loadNotification(redis, member)
      if (!rec) continue
      if (rec.enabled === false) continue
      if (rec.nextSendAt <= now) due.push(member)
    }
    return due
  }
}

export async function countRegistered(redis: Redis) {
  try {
    return await redis.zcard(NOTIF_KEYS.dueZ)
  } catch {
    return 0
  }
}

export async function soonestNextSendAt(redis: Redis) {
  // We keep nextSendAt inside the record, so we can just read the first member.
  const earliest = await redis.zrange(NOTIF_KEYS.dueZ, 0, 0)
  if (!earliest || earliest.length === 0) return null
  const rec = await loadNotification(redis, String(earliest[0]))
  return rec ? rec.nextSendAt : null
}

export async function listEvents(redis: Redis, limit: number = 50) {
  const raw = await redis.lrange(NOTIF_KEYS.events, 0, Math.max(0, limit - 1))
  return raw
    .map((x: any) => {
      try {
        return JSON.parse(String(x)) as WebhookEventLog
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

export async function rescheduleAll(redis: Redis, hours: number) {
  const cadence = Number(hours)
  if (!Number.isFinite(cadence) || cadence <= 0) throw new Error('Invalid hours')

  // Scan a chunk of members and update their cadence + nextSendAt.
  const members = await redis.zrange(NOTIF_KEYS.dueZ, 0, 999)
  const now = Math.floor(Date.now() / 1000)
  let updated = 0

  for (const m of members) {
    const member = String(m)
    const rec = await loadNotification(redis, member)
    if (!rec) continue
    if (rec.enabled === false) continue
    const nextSendAt = now + cadence * 60 * 60
    const newRec: NotifRecord = normalizeRecord({ ...rec, cadenceHours: cadence, nextSendAt, updatedAt: now })
    await redis.set(NOTIF_KEYS.user(rec.fid, rec.appFid), JSON.stringify(newRec))
    await redis.zadd(NOTIF_KEYS.dueZ, { score: nextSendAt, member })
    updated++
  }

  return { updated, scanned: members.length, cadenceHours: cadence }
}
