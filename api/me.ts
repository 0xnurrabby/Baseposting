import { adjustCredits, canClaimShareBonus, getOrCreateUser, incrementMetric } from './_lib/store.js'
import { handleOptions, json, readJson, requirePost, setCors } from './_lib/http.js'
import { migrateFidToAddressIfPossible } from './_lib/leaderboard.js'

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

  // action=claim — add +1 credit after wallet confirmation (no onchain verify needed)
  if (body?.action === 'claim') {
    try {
      await incrementMetric(userId, 'txCount', 1, 1)
      const updated = await adjustCredits(userId, +1)
      return json(res, 200, { ok: true, credits: updated.credits })
    } catch (e: any) {
      return json(res, 500, { error: e?.message || 'Failed to add credit' })
    }
  }

  // Default: return user info
  if (userId.startsWith('addr:')) {
    const addr = userId.slice(5)
    try {
      await migrateFidToAddressIfPossible(addr)
    } catch {
      // never fail /me because of migration hiccups
    }
  }

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
