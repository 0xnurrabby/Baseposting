import crypto from 'node:crypto'
import { Redis } from '@upstash/redis'

type StoredImage = {
  id: string
  mime: string
  // base64 (no data: prefix)
  b64: string
  createdAt: string
}

const memory = new Map<string, StoredImage>()

function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
}

function nowIso() {
  return new Date().toISOString()
}

export function newImageId() {
  // Short-ish, URL-safe id
  return crypto.randomUUID().replace(/-/g, '')
}

export async function putImage(args: { id: string; mime: string; b64: string; ttlSeconds?: number }) {
  const record: StoredImage = { id: args.id, mime: args.mime, b64: args.b64, createdAt: nowIso() }
  const redis = getRedis()
  if (!redis) {
    memory.set(args.id, record)
    return
  }

  const key = `img:${args.id}`
  const ttl = Math.max(60, args.ttlSeconds ?? 60 * 60 * 24 * 7) // default 7 days
  await redis.set(key, record, { ex: ttl })
}

export async function getImage(id: string): Promise<StoredImage | null> {
  const redis = getRedis()
  if (!redis) return memory.get(id) || null
  const key = `img:${id}`
  const record = await redis.get<StoredImage>(key)
  return record || null
}
