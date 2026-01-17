import { createPublicClient, http } from 'viem'
import { base } from 'viem/chains'
import { adjustCredits, txAlreadyCounted, markTxCounted, getOrCreateUser, incrementMetric } from './_lib/store.js'
import { handleOptions, json, readJson, requirePost, setCors } from './_lib/http.js'

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

  const txHash = String(body?.txHash || '').trim()
  if (!isTxHash(txHash)) return json(res, 400, { error: 'Invalid txHash' })

  if (await txAlreadyCounted(txHash)) {
    const u = await getOrCreateUser(userId)
    return json(res, 200, { ok: true, alreadyCounted: true, credits: u.credits })
  }

  try {
    const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org'
    const client = createPublicClient({ chain: base, transport: http(rpcUrl) })

    // RPCs (especially public endpoints) can lag right after a tx is broadcast.
    // Wait/poll for a short time instead of failing immediately with "tx not found".
    let receipt: any
    try {
      receipt = await client.waitForTransactionReceipt({
        hash: txHash as `0x${string}`,
        timeout: 45_000,
        pollingInterval: 2_000,
      })
    } catch (e: any) {
      const msg = String(e?.message || '')
      // Return a "pending" response so the client can retry without showing a scary error.
      if (msg.toLowerCase().includes('could not be found') || msg.toLowerCase().includes('timeout')) {
        const u = await getOrCreateUser(userId)
        return json(res, 202, { ok: false, pending: true, credits: u.credits })
      }
      throw e
    }

    if (!receipt || receipt.status !== 'success') return json(res, 400, { error: 'Transaction not successful' })

    // Fetch the transaction (with a few retries) to validate the destination contract.
    let tx: any = null
    for (let i = 0; i < 5; i++) {
      try {
        tx = await client.getTransaction({ hash: txHash as `0x${string}` })
        if (tx) break
      } catch {
        // ignore
      }
      await new Promise((r) => setTimeout(r, 800))
    }

    const contractLower = CONTRACT.toLowerCase()

    // In smart-wallet / account-abstraction flows, the outer transaction "to" may be an
    // entrypoint/bundler contract, while the credit contract call happens internally.
    // So we accept either:
    //  - tx.to === CONTRACT (EOA direct call)
    //  - OR the receipt contains at least one log emitted by CONTRACT (internal call)
    const to = (tx?.to || receipt?.to || '').toString().toLowerCase()
    const hasContractLog = Array.isArray(receipt?.logs)
      ? receipt.logs.some((l: any) => String(l?.address || '').toLowerCase() === contractLower)
      : false

    if (to !== contractLower && !hasContractLog) {
      return json(res, 400, { error: 'Transaction not sent to the credit contract' })
    }

    await markTxCounted(txHash)
    // Count successful credit transactions for admin stats.
    await incrementMetric(userId, 'txCount', 1, 5)
    const updated = await adjustCredits(userId, +1)

    return json(res, 200, { ok: true, alreadyCounted: false, credits: updated.credits })
  } catch (e: any) {
    return json(res, 500, { error: e?.message || 'Failed to verify transaction' })
  }
}
