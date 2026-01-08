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

export function requirePost(req: any, res: any) {(req: any, res: any) {
  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method Not Allowed' })
    return false
  }
  return true
}
