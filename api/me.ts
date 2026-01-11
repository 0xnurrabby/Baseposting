import { canClaimShareBonus, getOrCreateUser, getRedisClient } from './_lib/store.js'
import { applyPendingGifts } from './_lib/gifts.js'
import { handleOptions, json, readJson, requirePost, setCors } from './_lib/http.js'

function toUserId(body: any) {
  const fid = body?.fid
  const address = body?.address
  if (typeof fid === 'number' && Number.isFinite(fid)) return `fid:${fid}`
  if (typeof fid === 'string' && fid.trim() && !Number.isNaN(Number(fid))) return `fid:${Number(fid)}`
  if (typeof address === 'string' && address.startsWith('0x') && address.length >= 42) return `addr:${address.toLowerCase()}`
  return null
}

export default async function handler(req: any, res: any) {
  setCors(req, res)
  if (handleOptions(req, res)) return
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

  // Apply any queued admin gifts (global or targeted by fid) when the user opens the Mini App.
  const fidNum = typeof body?.fid === 'number' ? body.fid : Number(body?.fid)
  const gifts = await applyPendingGifts({
    redis: getRedisClient(),
    userId,
    fid: Number.isFinite(fidNum) ? fidNum : undefined,
  })
  if (gifts.total) {
    user.credits = Math.max(0, user.credits + gifts.total)
    user.updatedAt = new Date().toISOString()
  }

  return json(res, 200, {
    ok: true,
    user: {
      id: user.id,
      credits: user.credits,
      lastShareAt: user.lastShareAt || null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    gifts,
    share: {
      canClaimToday: share.ok,
      todayUtc: share.today,
    },
  })
}