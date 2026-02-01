import { json } from './http.js'

export function checkBearer(req: any, secretEnvName: string) {
  const secret = process.env[secretEnvName]
  if (!secret) return false
  const authRaw = (
    req?.headers?.authorization ||
    req?.headers?.Authorization ||
    // QStash forwarded auth header
    req?.headers?.['upstash-forward-authorization'] ||
    req?.headers?.['Upstash-Forward-Authorization'] ||
    ''
  )
    .toString()
    .trim()
  if (!authRaw) return false
  // Normalize "Bearer <token>"
  return authRaw === `Bearer ${secret}`
}

export function requireBearer(req: any, res: any, secretEnvName: string) {
  if (checkBearer(req, secretEnvName)) return true
  json(res, 401, { ok: false, error: 'Unauthorized' })
  return false
}
