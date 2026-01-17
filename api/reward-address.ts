import { handleOptions, json, readJson, requirePost, setCors } from './_lib/http.js'
import { LB_KEYS, getRedisRaw } from './_lib/store.js'

function parseFid(raw: any): number | null {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

function isBaseAddress(addr: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(addr)
}

export default async function handler(req: any, res: any) {
  setCors(req, res)
  if (handleOptions(req, res)) return

  const redis = await getRedisRaw()
  if (!redis) return json(res, 500, { error: 'Server missing Redis configuration' })

  if (req.method === 'GET') {
    const fid = parseFid(req?.query?.fid)
    if (fid == null) return json(res, 400, { error: 'Missing fid' })
    try {
      const rec = await redis.hgetall<Record<string, string>>(LB_KEYS.rewardRec(fid))
      const has = rec && Object.keys(rec).length > 0
      return json(res, 200, { ok: true, exists: Boolean(has), record: has ? rec : null })
    } catch {
      return json(res, 200, { ok: true, exists: false, record: null })
    }
  }

  if (!requirePost(req, res)) return

  let body: any = {}
  try {
    body = await readJson(req)
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' })
  }

  const fid = parseFid(body?.fid)
  if (fid == null) return json(res, 400, { error: 'Missing fid' })

  const addressRaw = String(body?.address || '').trim()
  if (!isBaseAddress(addressRaw)) return json(res, 400, { error: 'Invalid Base address' })

  const address = addressRaw.toLowerCase()
  const username = String(body?.username || '').trim()
  const displayName = String(body?.displayName || '').trim()
  const pfpUrl = String(body?.pfpUrl || '').trim()

  const key = LB_KEYS.rewardRec(fid)
  const patch: Record<string, string> = {
    fid: String(fid),
    address,
    username,
    displayName,
    pfpUrl,
    updatedAt: new Date().toISOString(),
  }

  try {
    // upsert
    await redis.hset(key, patch)
    await redis.sadd(LB_KEYS.rewardFids, String(fid))
    return json(res, 200, { ok: true, fid, address })
  } catch (e: any) {
    return json(res, 500, { error: e?.message || 'Failed to save address' })
  }
}
