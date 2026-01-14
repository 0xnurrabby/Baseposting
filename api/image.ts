import { getImage } from './_lib/imageStore.js'
import { handleOptions, setCors } from './_lib/http.js'

export default async function handler(req: any, res: any) {
  if (handleOptions(req, res)) return
  setCors(req, res)

  const id = String(req?.query?.id || '').trim()
  if (!id) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Missing id' }))
    return
  }

  const record = await getImage(id)
  if (!record) {
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Not found' }))
    return
  }

  const buf = Buffer.from(record.b64, 'base64')
  res.statusCode = 200
  res.setHeader('Content-Type', record.mime || 'image/png')
  // Cache a bit; content is immutable per id.
  res.setHeader('Cache-Control', 'public, max-age=86400, immutable')
  res.end(buf)
}
