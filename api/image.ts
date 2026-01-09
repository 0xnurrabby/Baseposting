import { getRedisClient } from './_lib/store.js'
import { handleOptions, setCors } from './_lib/http.js'

export default async function handler(req: any, res: any) {
  setCors(res)
  if (handleOptions(req, res)) return

  if (req.method !== 'GET') {
    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
    return
  }

  const id = String(req.query?.id || '').trim()
  if (!id) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: 'Missing id' }))
    return
  }

  const redis = getRedisClient()
  if (!redis) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: 'Image storage is not configured (missing Redis)' }))
    return
  }

  const raw = await redis.get<string>(`bpimg:${id}`)
  if (!raw) {
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: 'Not found' }))
    return
  }

  let data: any = null
  try {
    data = JSON.parse(raw)
  } catch {
    data = null
  }

  const b64 = data?.b64
  const mimeType = data?.mimeType || 'image/png'
  if (typeof b64 !== 'string') {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: 'Corrupt image data' }))
    return
  }

  const bytes = Buffer.from(b64, 'base64')

  // Make it embeddable.
  res.statusCode = 200
  res.setHeader('Content-Type', mimeType)
  res.setHeader('Cache-Control', 'public, max-age=86400, immutable')
  res.end(bytes)
}
