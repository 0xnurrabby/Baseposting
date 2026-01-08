import { adjustCredits, canClaimShareBonus, markShareClaimed, getOrCreateUser } from './_lib/store'
import { json, readJson, requirePost } from './_lib/http'

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

  // We only award credits after a successful composeCast result on the client.
  // The server enforces the once-per-UTC-day rule.
  const check = await canClaimShareBonus(userId)
  if (!check.ok) {
    const u = await getOrCreateUser(userId)
    return json(res, 200, { ok: true, alreadyClaimed: true, credits: u.credits, todayUtc: check.today })
  }

  await markShareClaimed(userId)
  const updated = await adjustCredits(userId, +2)

  return json(res, 200, { ok: true, alreadyClaimed: false, credits: updated.credits, todayUtc: check.today })
}
