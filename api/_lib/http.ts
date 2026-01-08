export function json(res: any, status: number, data: unknown) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.status(status).send(JSON.stringify(data))
}

export async function readJson(req: any) {
  if (req.body && typeof req.body === 'object') return req.body

  return await new Promise<any>((resolve, reject) => {
    let buf = ''
    req.on('data', (chunk: any) => {
      buf += chunk
    })
    req.on('end', () => {
      try {
        resolve(buf ? JSON.parse(buf) : {})
      } catch (e) {
        reject(e)
      }
    })
  })
}

export function requirePost(req: any, res: any) {
  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method Not Allowed' })
    return false
  }
  return true
}
