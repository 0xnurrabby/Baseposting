import { handleOptions, json, setCors } from './_lib/http.js'
import { getImage } from './_lib/image-store.js'

export default async function handler(req: any, res: any) {
  setCors(req, res)
  if (handleOptions(req, res)) return

  if (req.method !== 'GET') {
    return json(res, 405, { error: 'Method Not Allowed' })
  }

  const q: any = (req as any)?.query || {}
  const id = String(q?.id || '').trim()
  if (!id) return json(res, 400, { error: 'Missing id' })

  const img = await getImage(id)
  if (!img) return json(res, 404, { error: 'Not found' })

  const buf = Buffer.from(img.bytesBase64Encoded, 'base64')
  res.setHeader('Content-Type', img.mimeType || 'image/png')
  // Cache in browsers/CDNs (the id is random, so it's safe to cache for a bit).
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600')
  res.status(200).send(buf)
}
