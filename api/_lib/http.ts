const ALLOWED_ORIGINS = new Set([
  'https://baseposting.online',
  'https://basepostingbro.vercel.app',
  'http://localhost:5173',
  'https://warpcast.com',
  'https://app.base.org',
])

function isAllowedOrigin(origin: string) {
  if (ALLOWED_ORIGINS.has(origin)) return true
  // Allow Vercel preview/prod domains for this app
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) return true
  // Allow local dev
  if (origin.startsWith('http://localhost:')) return true
  return false
}

export function setCors(req: any, res: any) {
  // Mini App webviews can send Origin: null (opaque origin). In that case we must
  // respond with '*' or the browser will block the request ("Failed to fetch").
  const originRaw = req?.headers?.origin
  const origin = originRaw == null ? '' : String(originRaw)

  const allowAll = origin === '' || origin === 'null'

  if (allowAll) {
    res.setHeader('Access-Control-Allow-Origin', '*')
  } else if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  } else {
    // Public API (no cookies). Safer to allow '*' than to mismatch the requester.
    res.setHeader('Access-Control-Allow-Origin', '*')
  }

  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Max-Age', '86400')
}


export function handleOptions(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    setCors(req, res)
    res.status(204).send('')
    return true
  }
  return false
}

export function json(res: any, status: number, data: unknown) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.status(status).send(JSON.stringify(data))
}

export async function readJson(req: any) {
  // Vercel Node API routes sometimes provide parsed body on req.body.
  if (req?.body && typeof req.body === 'object') return req.body

  // In some runtimes, req may not be a Node stream. Try Web Request style.
  if (typeof req?.json === 'function') {
    try {
      return await req.json()
    } catch {
      // fall through
    }
  }

  // If req is not a stream, return empty object instead of crashing.
  if (typeof req?.on !== 'function') return {}

  return await new Promise<any>((resolve, reject) => {
    let buf = ''
    req.on('data', (chunk: any) => {
      buf += chunk
    })
    req.on('end', () => {
      try {
        const trimmed = (buf || '').trim()
        if (!trimmed) return resolve({})
        resolve(JSON.parse(trimmed))
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

export function requirePost(req: any, res: any) {
  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method Not Allowed' })
    return false
  }
  return true
}
