import { handleOptions, json, setCors } from './_lib/http.js'

function normalizeUrlMaybe(v: string) {
  const s = String(v || '').trim()
  if (!s) return ''
  if (s.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${s.slice('ipfs://'.length)}`
  if (s.startsWith('http://')) return `https://${s.slice('http://'.length)}`
  return s
}

async function fetchWithTimeout(url: string, ms: number) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, {
      headers: {
        Accept: '*/*',
        'User-Agent': 'BasePosting/pfp',
      },
      cache: 'force-cache' as any,
      signal: ctrl.signal,
    })
  } finally {
    clearTimeout(t)
  }
}

export default async function handler(req: any, res: any) {
  setCors(req, res)
  if (handleOptions(req, res)) return

  if (req.method !== 'GET') return json(res, 405, { error: 'Method Not Allowed' })

  const u = String(req?.query?.u || '').trim()
  if (!u) return json(res, 400, { error: 'Missing u' })

  const url = normalizeUrlMaybe(u)
  if (!url) return json(res, 400, { error: 'Invalid u' })
  if (url.length > 500) return json(res, 400, { error: 'URL too long' })

  // Only proxy https resources (plus ipfs:// normalized to https above)
  if (!url.startsWith('https://')) return json(res, 400, { error: 'Only https URLs allowed' })

  try {
    const r = await fetchWithTimeout(url, 8000)
    if (!r.ok) {
      return json(res, 404, { error: 'Image not found' })
    }

    const contentType = r.headers.get('content-type') || 'image/*'
    const buf = Buffer.from(await r.arrayBuffer())

    res.setHeader('Content-Type', contentType)
    // Cache on CDN + client (pfps change rarely)
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400')
    res.status(200).send(buf)
  } catch (e: any) {
    return json(res, 502, { error: 'Failed to fetch image' })
  }
}
