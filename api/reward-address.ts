import { handleOptions, json, readJson, requirePost, setCors } from './_lib/http.js'
import { getRewardAddress, setRewardAddress } from './_lib/leaderboard.js'

function toUserId(bodyOrQuery: any) {
  const fid = bodyOrQuery?.fid
  const address = bodyOrQuery?.address
  if (typeof fid === 'number' && Number.isFinite(fid)) return `fid:${fid}`
  if (typeof fid === 'string' && fid.trim() && !Number.isNaN(Number(fid))) return `fid:${Number(fid)}`
  // reward address submissions are only allowed for Farcaster IDs in this app
  if (typeof address === 'string' && address.startsWith('0x') && address.length >= 42) return `addr:${address.toLowerCase()}`
  return null
}

function isBaseAddress(addr: string) {
  const a = String(addr || '').trim()
  return /^0x[a-fA-F0-9]{40}$/.test(a)
}

export default async function handler(req: any, res: any) {
  setCors(req, res)
  if (handleOptions(req, res)) return

  // GET: fetch current submitted base address (if any)
  if (req.method === 'GET') {
    const url = new URL(req.url || '', 'http://x')
    const fid = url.searchParams.get('fid')
    const userId = toUserId({ fid })
    if (!userId) return json(res, 400, { ok: false, error: 'Missing fid' })

    const existing = await getRewardAddress(userId)
    return json(res, 200, { ok: true, userId, baseAddress: existing })
  }

  if (!requirePost(req, res)) return

  let body: any = {}
  try {
    body = await readJson(req)
  } catch {
    return json(res, 400, { ok: false, error: 'Invalid JSON body' })
  }

  const userId = toUserId(body)
  if (!userId || !userId.startsWith('fid:')) {
    return json(res, 400, { ok: false, error: 'Missing fid' })
  }

  const baseAddress = String(body?.baseAddress || '').trim()
  if (!isBaseAddress(baseAddress)) {
    return json(res, 400, { ok: false, error: 'Invalid Base address' })
  }

  try {
    await setRewardAddress(userId, baseAddress)
    return json(res, 200, { ok: true, userId, baseAddress })
  } catch (e: any) {
    return json(res, 500, { ok: false, error: String(e?.message || e || 'Failed') })
  }
}
