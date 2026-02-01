import { parseWebhookEvent, verifyAppKeyWithNeynar } from '@farcaster/miniapp-node'
import type { Redis } from '@upstash/redis'
import { getRedisClient } from './_lib/store.js'
import { handleOptions, json, setCors } from './_lib/http.js'
import { disableNotifications, pushEvent, upsertNotificationDetails } from './_lib/notifications.js'

type ParsedWebhookData = {
  fid: number
  appFid: number
  event: {
    event: 'miniapp_added' | 'miniapp_removed' | 'notifications_enabled' | 'notifications_disabled' | string
    notificationDetails?: {
      token: string
      url: string
    }
  }
}

/** ---------- cache helpers (module-scope) ---------- **/
const memCache = new Map<string, { exp: number; val: string }>() // key -> { expiresAtMs, jsonValue }
const inflight = new Map<string, Promise<any>>() // burst-dedupe

function safeStringify(x: any) {
  return JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
}

function memGet(key: string): string | null {
  const hit = memCache.get(key)
  if (!hit) return null
  if (Date.now() > hit.exp) {
    memCache.delete(key)
    return null
  }
  return hit.val
}

function memSet(key: string, ttlSeconds: number, val: string) {
  memCache.set(key, { exp: Date.now() + ttlSeconds * 1000, val })
}

function isVerifyOk(result: any): boolean {
  if (result === true) return true
  if (!result) return false
  if (typeof result !== 'object') return false
  // Support multiple possible shapes across library versions.
  return Boolean((result as any).ok ?? (result as any).isValid ?? (result as any).valid ?? (result as any).success ?? (result as any).verified)
}

function isRateLimitError(e: any) {
  // Neynar / hub errors can be nested in different places depending on runtime/lib.
  // We'll do a deep-ish stringify and look for common signals.
  const status = Number(e?.status || e?.statusCode || e?.response?.status || 0)
  const code = String(e?.code || e?.response?.data?.code || e?.data?.code || '')
  const msg = String(e?.message || e?.response?.data?.message || e?.data?.message || e || '')

  if (status === 429) return true
  if (code === 'RateLimitExceeded') return true

  const blob = (() => {
    try {
      return JSON.stringify(
        e,
        (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
        0
      )
    } catch {
      return ''
    }
  })()

  const hay = (msg + ' ' + blob).toLowerCase()
  return (
    hay.includes('ratelimitexceeded') ||
    hay.includes('rate limit') ||
    hay.includes('status 429') ||
    hay.includes('429')
  )
}


class VerifyThrottledError extends Error {
  constructor(message = 'verify_throttled') {
    super(message)
    this.name = 'VerifyThrottledError'
  }
}

function makeVerifier(redis: Redis, ttlSeconds: number) {
  const apiKey = process.env.NEYNAR_API_KEY

  // Base docs: parseWebhookEvent(payload, verifyAppKeyWithNeynar)
  // Some setups use verifyAppKeyWithNeynar(apiKey) -> function
  let baseVerifier: any = verifyAppKeyWithNeynar as any

  if (apiKey) {
    try {
      const maybe = (verifyAppKeyWithNeynar as any)(apiKey)
      if (typeof maybe === 'function') baseVerifier = maybe
    } catch {
      // ignore and fall back
    }
  }

  // cached wrapper
  return async (...args: any[]) => {
    // key based on verifier args (usually includes appKey/appFid etc.)
    const key = `miniapp:verify:${safeStringify(args)}`
    const redisKey = key
    const ttl = Math.max(60, Number(ttlSeconds) || 15 * 60)

    // 1) in-memory fast path (per instance)
    const memHit = memGet(key)
    if (memHit) {
      try {
        return JSON.parse(memHit)
      } catch {
        return memHit
      }
    }

    // 2) redis fast path (shared across instances)
    try {
      const hit = await redis.get(redisKey)
      if (hit) {
        const s = String(hit)
        memSet(key, ttl, s)
        try {
          return JSON.parse(s)
        } catch {
          return s
        }
      }
    } catch {
      // ignore redis read errors
    }

    // 3) burst dedupe (avoid N parallel verifies)
    const existing = inflight.get(key)
    if (existing) return await existing

    const p = (async () => {
      try {
        const result = await baseVerifier(...args)
        if (isVerifyOk(result) || result === true) {
          const v = safeStringify(result)
          memSet(key, ttl, v)
          try {
            // Upstash style: set(key, val, { ex })
            await redis.set(redisKey, v, { ex: ttl })
          } catch {
            // ignore cache set errors
          }
        }
        return result
      } catch (e: any) {
        // IMPORTANT: rate limit হলে এখানে special error throw করব,
        // যাতে handler 200 রিটার্ন করতে পারে (retries থামাতে)
        if (isRateLimitError(e)) {
          throw new VerifyThrottledError(String(e?.message || 'rate_limited'))
        }
        throw e
      } finally {
        inflight.delete(key)
      }
    })()

    inflight.set(key, p)
    return await p
  }
}

async function readRawBody(req: any): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    let data = ''
    req.on('data', (chunk: any) => (data += chunk))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

export default async function handler(req: any, res: any) {
  setCors(req, res)
  if (handleOptions(req, res)) return

  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method Not Allowed' })
  }

  let bodyText = ''
  try {
    bodyText = await readRawBody(req)
  } catch {
    return json(res, 400, { ok: false, error: 'Unable to read body' })
  }

  const redis = getRedisClient()
  if (!redis) return json(res, 500, { ok: false, error: 'Redis not configured' })

  // Try parse JSON, but keep raw-string fallback
  let bodyJson: any = null
  try {
    bodyJson = JSON.parse(bodyText)
  } catch {
    bodyJson = null
  }

  const ttlSeconds = Number(process.env.WEBHOOK_VERIFY_TTL_SECONDS || 15 * 60) // default 15 min

  let data: ParsedWebhookData
  try {
    // The verifier function type differs across miniapp-node versions.
    // We keep runtime behavior correct and let TS treat it loosely.
    data = (await parseWebhookEvent(bodyJson ?? bodyText, makeVerifier(redis, ttlSeconds) as any)) as any
  } catch (e: any) {
    // ✅ rate limit / throttled -> 200 (stop retries)
    if (e?.name === 'VerifyThrottledError' || isRateLimitError(e)) {
      console.warn('Webhook verify throttled (Neynar 429). Returning 200 to stop retries.', e?.message || e)
      return json(res, 200, { ok: true, warning: 'verify_throttled' })
    }

    // The miniapp docs note that Farcaster clients retry on non-200 responses.
    // For invalid signatures or verifier failures, retrying usually makes things worse (extra retries -> extra Neynar calls -> more 429s).
    // So we return 200 but DO NOT process the event.
    const name = String(e?.name || '')
    const msg = String(e?.message || e || 'verify_error')

    console.warn('Webhook verify failed. Returning 200 and ignoring event.', { name, msg })

    return json(res, 200, { ok: false, warning: 'verify_failed', name, error: msg })
  }

  const fid = Number(data?.fid)
  const appFid = Number(data?.appFid)
  const event = data?.event
  const evtType = String(event?.event || 'unknown')
  const details = event?.notificationDetails

  // log event (optional)
  try {
    await pushEvent(redis, { ts: Date.now(), type: evtType, data: { fid, appFid, event } })
  } catch {
    // ignore logging failures
  }

  try {
    switch (evtType) {
      case 'miniapp_added':
      case 'notifications_enabled': {
        if (details?.token && details?.url) {
          await upsertNotificationDetails(redis, fid, appFid, {
            token: String(details.token),
            url: String(details.url),
          })
        }
        break
      }

      case 'miniapp_removed':
      case 'notifications_disabled': {
        await disableNotifications(redis, fid, appFid)
        break
      }

      default: {
        break
      }
    }
  } catch (e) {
    // Don't fail webhook response if storage fails
    console.error('webhook storage error', e)
  }

  return json(res, 200, { ok: true })
}
