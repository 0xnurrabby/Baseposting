import { adjustCredits, getOrCreateUser, incrementMetric, markTxCounted, txAlreadyCounted } from './_lib/store.js'
import { handleOptions, json, readJson, requirePost, setCors } from './_lib/http.js'

function toUserId(body: any) {
  const fid = body?.fid
  const address = body?.address
  if (typeof fid === 'number' && Number.isFinite(fid)) return `fid:${fid}`
  if (typeof fid === 'string' && fid.trim() && !Number.isNaN(Number(fid))) return `fid:${Number(fid)}`
  if (typeof address === 'string' && address.startsWith('0x') && address.length >= 42) return `addr:${address.toLowerCase()}`
  return null
}

function isProofId(x: string) {
  return /^0x[a-fA-F0-9]{64}$/.test(x) || /^[a-zA-Z0-9:_-]{8,140}$/.test(x)
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

  const proofId = String(body?.txHash || body?.proofId || '').trim()
  if (!isProofId(proofId)) return json(res, 400, { error: 'Invalid transaction proof' })

  try {
    await getOrCreateUser(userId)
    const alreadyCounted = await txAlreadyCounted(proofId)
    if (alreadyCounted) {
      const current = await getOrCreateUser(userId)
      return json(res, 200, { ok: true, alreadyCounted: true, credits: current.credits, txHash: proofId })
    }

    await markTxCounted(proofId)
    await incrementMetric(userId, 'txCount', 1, 1)
    const updated = await adjustCredits(userId, +1)
    return json(res, 200, { ok: true, credits: updated.credits, txHash: proofId })
  } catch (e: any) {
    return json(res, 500, { error: e?.message || 'Failed to add credit' })
  }
}
