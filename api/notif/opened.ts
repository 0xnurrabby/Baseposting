import { getRedisClient } from '../_lib/store.js'
import { handleOptions, json, readJson, setCors } from '../_lib/http.js'
import { markOpened } from '../_lib/notifications.js'

export default async function handler(req: any, res: any) {
  setCors(req, res)
  if (handleOptions(req, res)) return

  if (req.method !== 'POST') return json(res, 405, { error: 'Method Not Allowed' })

  const body = await readJson(req).catch(() => ({}))
  const fid = Number(body?.fid)
  const appFid = Number(body?.appFid)
  const nid = body?.nid ? String(body.nid) : undefined

  if (!Number.isFinite(fid) || !Number.isFinite(appFid)) {
    return json(res, 400, { error: 'Invalid fid/appFid' })
  }

  const redis = getRedisClient()
  const now = Math.floor(Date.now() / 1000)

  await markOpened(redis, fid, appFid, now, { nid })

  return json(res, 200, { ok: true })
}
