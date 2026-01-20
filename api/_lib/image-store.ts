import crypto from 'node:crypto'
import { getRedisClient } from './store.js'

type StoredImage = {
  mimeType: string
  bytesBase64Encoded: string
}

// Best-effort in-memory fallback (works in local dev; serverless instances may not share memory).
const memory = new Map<string, StoredImage>()

function safeId() {
  return crypto.randomUUID().replace(/-/g, '')
}

export async function putImage(img: StoredImage, ttlSeconds = 60 * 60 * 24) {
  const id = safeId()
  const key = `img:${id}`

  const redis = getRedisClient()
  if (!redis) {
    memory.set(key, img)
    return { id }
  }

  await redis.set(key, JSON.stringify(img), { ex: ttlSeconds })
  return { id }
}

export async function getImage(id: string): Promise<StoredImage | null> {
  const key = `img:${id}`
  const redis = getRedisClient()

  if (!redis) return memory.get(key) || null

  const raw = await redis.get<string | null>(key)
  if (!raw) return null
  try {
    const data = JSON.parse(raw)
    const mimeType = String(data?.mimeType || '')
    const bytesBase64Encoded = String(data?.bytesBase64Encoded || '')
    if (!mimeType || !bytesBase64Encoded) return null
    return { mimeType, bytesBase64Encoded }
  } catch {
    return null
  }
}
