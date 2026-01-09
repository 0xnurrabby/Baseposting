import crypto from 'node:crypto'
import { getRedisClient } from './store.js'

const DAILY_LIMIT_PER_KEY = 90

function parseKeys() {
  const raw =
    process.env.GEMINI_API_KEYS ||
    process.env.GOOGLE_AI_KEYS ||
    process.env.GOOGLE_AI_STUDIO_KEYS ||
    process.env.GEMINI_API_KEY ||
    ''

  return raw
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

async function reserveKeyForToday(keys: string[]) {
  const redis = getRedisClient()
  const date = utcDateKey()

  // If no Redis is configured, do a simple round-robin (best effort).
  if (!redis) {
    // Shuffle to spread load.
    const shuffled = [...keys].sort(() => Math.random() - 0.5)
    return { key: shuffled[0], keyId: keyHash(shuffled[0]) }
  }

  // Try each key; reserve quota atomically.
  for (const k of keys) {
    const id = keyHash(k)
    const usageKey = `gaimg:${date}:${id}`
    const next = await redis.incr(usageKey)
    if (next <= DAILY_LIMIT_PER_KEY) {
      // Keep the counter around a bit longer than 24h.
      if (next === 1) await redis.expire(usageKey, 60 * 60 * 48)
      return { key: k, keyId: id }
    }

    // Over limit -> undo reservation and continue.
    await redis.incrby(usageKey, -1)
  }

  return null
}

function pickImageBytesFromPredictions(pred: any): { b64: string; mimeType: string } | null {
  if (!pred) return null

  // Common patterns we've seen across Gemini/Imagen APIs.
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

export async function generateImageWithImagen(prompt: string) {
  const keys = parseKeys()
  if (!keys.length) {
    const err: any = new Error('Missing image API keys (set GEMINI_API_KEYS)')
    err.status = 500
    throw err
  }

  const reserved = await reserveKeyForToday(keys)
  if (!reserved) {
    const err: any = new Error('All image API keys have reached the 90/day limit')
    err.status = 429
    throw err
  }

  // Imagen models via the Gemini API use the generic models.predict endpoint. See:
  // https://ai.google.dev/gemini-api/docs/imagen
  const model = process.env.IMAGE_MODEL || 'models/imagen-4.0-generate-001'
  const url = `https://generativelanguage.googleapis.com/v1beta/${model}:predict`

  const body = {
    instances: [{ prompt }],
    parameters: {
      sampleCount: 1,
      aspectRatio: '1:1',
      // You can optionally set imageSize: '1K' | '2K' if your quota supports it.
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
    const err: any = new Error(data?.error?.message || data?.error || `Image API failed (${r.status})`)
    err.status = r.status
    err.data = data
    throw err
  }

  const preds = Array.isArray(data?.predictions) ? data.predictions : []
  const img = pickImageBytesFromPredictions(preds[0])
  if (!img) {
    const err: any = new Error('Image API returned no image bytes')
    err.status = 502
    err.data = data
    throw err
  }

  return img
}
