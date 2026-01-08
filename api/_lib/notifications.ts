import type { Redis } from '@upstash/redis'

export const NOTIF_KEYS = {
  dueZ: 'notif:due:z', // ZSET member="fid:appFid" score=nextSendAt (unix seconds)
  user: (fid: number, appFid: number) => `notif:user:${fid}:${appFid}`,
  events: 'notif:events:l',
}

export type NotifRecord = {
  fid: number
  appFid: number
  token: string
  url: string
  cadenceHours: number
  nextSendAt: number
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

export async function upsertNotificationDetails(
  redis: Redis,
  fid: number,
  appFid: number,
  details: { token: string; url: string },
) {
  const now = Math.floor(Date.now() / 1000)
  const cadence = cadenceHours()

  const rec: NotifRecord = {
    fid,
    appFid,
    token: details.token,
    url: details.url,
    cadenceHours: cadence,
    nextSendAt: now + cadence * 60 * 60,
  }

  await redis.set(NOTIF_KEYS.user(fid, appFid), JSON.stringify(rec))
  await redis.zadd(NOTIF_KEYS.dueZ, { score: rec.nextSendAt, member: memberId(fid, appFid) })

  return rec
}

export async function disableNotifications(redis: Redis, fid: number, appFid: number) {
  await redis.del(NOTIF_KEYS.user(fid, appFid))
  await redis.zrem(NOTIF_KEYS.dueZ, memberId(fid, appFid))
}

export async function loadNotification(redis: Redis, member: string) {
  const [fidStr, appFidStr] = member.split(':')
  const fid = Number(fidStr)
  const appFid = Number(appFidStr)
  if (!Number.isFinite(fid) || !Number.isFinite(appFid)) return null
  const raw = await redis.get(NOTIF_KEYS.user(fid, appFid))
  if (!raw) return null
  try {
    return JSON.parse(String(raw)) as NotifRecord
  } catch {
    return null
  }
}

export async function markSent(redis: Redis, rec: NotifRecord, now: number) {
  const next = now + rec.cadenceHours * 60 * 60
  const updated: NotifRecord = { ...rec, nextSendAt: next }
  await redis.set(NOTIF_KEYS.user(rec.fid, rec.appFid), JSON.stringify(updated))
  await redis.zadd(NOTIF_KEYS.dueZ, { score: next, member: memberId(rec.fid, rec.appFid) })
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
    return members.map((m: any) => String(m))
  } catch {
    // Fallback: grab the earliest N scheduled and filter by nextSendAt stored in the record.
    const earliest = await redis.zrange(NOTIF_KEYS.dueZ, 0, maxScan - 1)
    const due: string[] = []
    for (const m of earliest) {
      const member = String(m)
      const rec = await loadNotification(redis, member)
      if (!rec) continue
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
    const nextSendAt = now + cadence * 60 * 60
    const newRec: NotifRecord = { ...rec, cadenceHours: cadence, nextSendAt }
    await redis.set(NOTIF_KEYS.user(rec.fid, rec.appFid), JSON.stringify(newRec))
    await redis.zadd(NOTIF_KEYS.dueZ, { score: nextSendAt, member })
    updated++
  }

  return { updated, scanned: members.length, cadenceHours: cadence }
}
