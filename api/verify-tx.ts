import { createPublicClient, http } from 'viem'
import { base } from 'viem/chains'
import { adjustCredits, txAlreadyCounted, markTxCounted, getOrCreateUser } from './_lib/store'
import { json, readJson, requirePost } from './_lib/http'

const CONTRACT = '0xB331328F506f2D35125e367A190e914B1b6830cF'

function toUserId(body: any) {
  const fid = body?.fid
  const address = body?.address
  if (typeof fid === 'number' && Number.isFinite(fid)) return `fid:${fid}`
  if (typeof fid === 'string' && fid.trim() && !Number.isNaN(Number(fid))) return `fid:${Number(fid)}`
  if (typeof address === 'string' && address.startsWith('0x') && address.length >= 42) return `addr:${address.toLowerCase()}`
  return null
}

function isTxHash(x: string) {
  return /^0x[a-fA-F0-9]{64}$/.test(x)
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

  const txHash = String(body?.txHash || '').trim()
  if (!isTxHash(txHash)) return json(res, 400, { error: 'Invalid txHash' })

  if (await txAlreadyCounted(txHash)) {
    const u = await getOrCreateUser(userId)
    return json(res, 200, { ok: true, alreadyCounted: true, credits: u.credits })
  }

  try {
    const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org'
    const client = createPublicClient({ chain: base, transport: http(rpcUrl) })

    const tx = await client.getTransaction({ hash: txHash as `0x${string}` })
    const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` })

    if (!receipt || receipt.status !== 'success') {
      return json(res, 400, { error: 'Transaction not successful' })
    }

    if (!tx.to || tx.to.toLowerCase() !== CONTRACT.toLowerCase()) {
      return json(res, 400, { error: 'Transaction not sent to the credit contract' })
    }

    await markTxCounted(txHash)
    const updated = await adjustCredits(userId, +1)

    return json(res, 200, { ok: true, alreadyCounted: false, credits: updated.credits })
  } catch (e: any) {
    return json(res, 500, { error: e?.message || 'Failed to verify transaction' })
  }
}
