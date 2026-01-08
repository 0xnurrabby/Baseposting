import { canClaimShareBonus, getOrCreateUser } from './_lib/store.js'
import { json, readJson, requirePost } from './_lib/http.js'

function toUserId(body: any) {
  const fid = body?.fid
  const address = body?.address
  if (typeof fid === 'number' && Number.isFinite(fid)) return `fid:${fid}`
  if (typeof fid === 'string' && fid.trim() && !Number.isNaN(Number(fid))) return `fid:${Number(fid)}`
  if (typeof address === 'string' && address.startsWith('0x') && address.length >= 42) return `addr:${address.toLowerCase()}`
  return null
}

export default async function handler(req: any, res: any) {
  if (!requirePost(req, res)) return

  let body: any = {}
  try {
    body = await readJson(req)
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' })
  }

  const userId = toUserId(body)
  if (!userId) return json(res, 400, { error: 'Missing user identity (fid or address)' })

  const user = await getOrCreateUser(userId)
  const share = await canClaimShareBonus(userId)

  return json(res, 200, {
    ok: true,
    user: {
      id: user.id,
      credits: user.credits,
      lastShareAt: user.lastShareAt || null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    share: {
      canClaimToday: share.ok,
      todayUtc: share.today,
    },
  })
}
