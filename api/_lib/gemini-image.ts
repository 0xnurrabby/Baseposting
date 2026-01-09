import crypto from 'node:crypto'
import { getRedisClient } from './store.js'

const DEFAULT_DAILY_LIMIT_PER_KEY = 90

function parseKeyList(raw: string) {
  return (raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function utcDateKey(d = new Date()) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function keyHash(key: string) {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)
}

async function reserveKeyForToday(keys: string[], namespace: string, dailyLimit: number) {
  const redis = getRedisClient()
  const date = utcDateKey()

  // If no Redis is configured, do a simple best-effort pick.
  if (!redis) {
    const shuffled = [...keys].sort(() => Math.random() - 0.5)
    return { key: shuffled[0], keyId: keyHash(shuffled[0]) }
  }

  for (const k of keys) {
    const id = keyHash(k)
    const usageKey = `${namespace}:${date}:${id}`
    const next = await redis.incr(usageKey)
    if (next <= dailyLimit) {
      if (next === 1) await redis.expire(usageKey, 60 * 60 * 48)
      return { key: k, keyId: id }
    }
    await redis.incrby(usageKey, -1)
  }

  return null
}

function pickImageBytesFromPredictions(pred: any): { b64: string; mimeType: string } | null {
  if (!pred) return null

  const candidates: Array<{ b64?: any; mime?: any }> = [
    { b64: pred?.bytesBase64Encoded, mime: pred?.mimeType },
    { b64: pred?.imageBytes, mime: pred?.mimeType },
    { b64: pred?.image?.imageBytes, mime: pred?.image?.mimeType },
    { b64: pred?.image?.bytesBase64Encoded, mime: pred?.image?.mimeType },
    { b64: pred?.image?.data, mime: pred?.image?.mimeType },
  ]

  for (const c of candidates) {
    const b64 = c.b64
    if (typeof b64 === 'string' && b64.length > 50) {
      const mimeType = typeof c.mime === 'string' && c.mime ? c.mime : 'image/png'
      return { b64, mimeType }
    }
  }
  return null
}

/**
 * Provider = "google" | "pollinations"
 * - IMAGE_PROVIDER=pollinations  -> Pollinations endpoint use
 * - IMAGE_PROVIDER=google        -> Google Imagen endpoint use
 */
function getProvider() {
  return (process.env.IMAGE_PROVIDER || 'google').toLowerCase()
}

/**
 * GOOGLE KEYS:
 * - GEMINI_API_KEYS=key1,key2,...
 */
function parseGoogleKeys() {
  const raw =
    process.env.GEMINI_API_KEYS ||
    process.env.GOOGLE_AI_KEYS ||
    process.env.GOOGLE_AI_STUDIO_KEYS ||
    process.env.GEMINI_API_KEY ||
    ''
  return parseKeyList(raw)
}

/**
 * POLLINATIONS KEYS (optional):
 * - POLLINATIONS_API_KEYS=key1,key2,...
 * If empty -> public endpoint used (no auth), no per-key limit.
 */
function parsePollinationsKeys() {
  const raw = process.env.POLLINATIONS_API_KEYS || process.env.POLLINATIONS_KEY || ''
  return parseKeyList(raw)
}

/**
 * Build Pollinations URL flexibly.
 * Default public endpoint (no key):
 *   https://image.pollinations.ai/prompt/<PROMPT>?width=1024&height=1024&model=flux&nofeed=true
 *
 * You can override base with POLLINATIONS_API_BASE.
 * - If base contains "{prompt}" placeholder -> replaced.
 * - Else if base ends with "/prompt/" -> prompt appended as path.
 * - Else -> prompt sent as ?prompt=
 */
function buildPollinationsUrl(prompt: string) {
  const base = process.env.POLLINATIONS_API_BASE || 'https://image.pollinations.ai/prompt/'
  const width = process.env.POLLINATIONS_WIDTH || '1024'
  const height = process.env.POLLINATIONS_HEIGHT || '1024'
  const model = process.env.POLLINATIONS_MODEL || 'flux'
  const nofeed = process.env.POLLINATIONS_NOFEED ?? 'true'
  const seed = process.env.POLLINATIONS_SEED || '' // optional

  const qp = new URLSearchParams()
  qp.set('width', String(width))
  qp.set('height', String(height))
  qp.set('model', String(model))
  qp.set('nofeed', String(nofeed))
  if (seed) qp.set('seed', String(seed))

  const enc = encodeURIComponent(prompt)

  if (base.includes('{prompt}')) {
    const u = base.replace('{prompt}', enc)
    return u.includes('?') ? `${u}&${qp.toString()}` : `${u}?${qp.toString()}`
  }

  if (base.endsWith('/prompt/')) {
    return `${base}${enc}?${qp.toString()}`
  }

  // generic fallback
  const u = new URL(base)
  u.searchParams.set('prompt', prompt)
  for (const [k, v] of qp.entries()) u.searchParams.set(k, v)
  return u.toString()
}

/**
 * GOOGLE (Imagen via Gemini API)
 */
async function generateImageWithGoogle(prompt: string) {
  const keys = parseGoogleKeys()
  if (!keys.length) {
    const err: any = new Error('Missing Google image API keys (set GEMINI_API_KEYS)')
    err.status = 500
    throw err
  }

  const dailyLimit = Number(process.env.IMAGE_DAILY_LIMIT_PER_KEY || DEFAULT_DAILY_LIMIT_PER_KEY)
  const reserved = await reserveKeyForToday(keys, 'img:google', dailyLimit)
  if (!reserved) {
    const err: any = new Error(`All Google image API keys reached ${dailyLimit}/day limit`)
    err.status = 429
    throw err
  }

  const model = process.env.IMAGE_MODEL || 'models/imagen-4.0-generate-001'
  const url = `https://generativelanguage.googleapis.com/v1beta/${model}:predict`

  const body = {
    instances: [{ prompt }],
    parameters: {
      sampleCount: 1,
      aspectRatio: '1:1',
    },
  }

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': reserved.key,
    },
    body: JSON.stringify(body),
  })

  const text = await r.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { error: text }
  }

  if (!r.ok) {
    const err: any = new Error(data?.error?.message || data?.error || `Google Image API failed (${r.status})`)
    err.status = r.status
    err.data = data
    throw err
  }

  const preds = Array.isArray(data?.predictions) ? data.predictions : []
  const img = pickImageBytesFromPredictions(preds[0])
  if (!img) {
    const err: any = new Error('Google Image API returned no image bytes')
    err.status = 502
    err.data = data
    throw err
  }

  return img
}

/**
 * POLLINATIONS
 * - If keys exist -> optional rotation + 90/day per key (Authorization: Bearer <key>)
 * - If no keys -> public endpoint (no auth)
 */
async function generateImageWithPollinations(prompt: string) {
  const keys = parsePollinationsKeys()
  const dailyLimit = Number(process.env.IMAGE_DAILY_LIMIT_PER_KEY || DEFAULT_DAILY_LIMIT_PER_KEY)

  let authKey: string | null = null
  if (keys.length) {
    const reserved = await reserveKeyForToday(keys, 'img:pollinations', dailyLimit)
    if (!reserved) {
      const err: any = new Error(`All Pollinations API keys reached ${dailyLimit}/day limit`)
      err.status = 429
      throw err
    }
    authKey = reserved.key
  }

  const url = buildPollinationsUrl(prompt)

  const headers: Record<string, string> = {}
  // Only attach Authorization if you actually have keys + your endpoint expects it.
  if (authKey) headers['Authorization'] = `Bearer ${authKey}`

  const r = await fetch(url, { method: 'GET', headers })

  if (!r.ok) {
    const t = await r.text().catch(() => '')
    const err: any = new Error(`Pollinations image error (${r.status}): ${t || 'Request failed'}`)
    err.status = r.status
    err.data = t
    throw err
  }

  const ct = r.headers.get('content-type') || 'image/png'
  const buf = Buffer.from(await r.arrayBuffer())
  const b64 = buf.toString('base64')
  return { b64, mimeType: ct.includes('image/') ? ct : 'image/png' }
}

/**
 * Backwards compatible export name:
 * your existing code calls generateImageWithImagen(prompt)
 * We'll keep that name, but route based on IMAGE_PROVIDER.
 */
export async function generateImageWithImagen(prompt: string) {
  const provider = getProvider()
  if (provider === 'pollinations') return generateImageWithPollinations(prompt)
  return generateImageWithGoogle(prompt)
}

// Optional named export if you want to call explicitly
export async function generateImageWithPollinations(prompt: string) {
  return generateImageWithPollinations(prompt)
}
