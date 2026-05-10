export const maxDuration = 30

import { adjustCredits, getOrCreateUser, incrementMetric, markTxCounted, txAlreadyCounted } from './_lib/store.js'
import { handleOptions, json, readJson, requirePost, setCors } from './_lib/http.js'

const CREDIT_CONTRACT = '0xb331328f506f2d35125e367a190e914b1b6830cf'

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

function isAddress(x: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(x)
}

// ─── RPC ──────────────────────────────────────────────────────────────────────

function rpcUrl() {
  const raw = String(process.env.BASE_RPC_URL || process.env.RPC_URL || 'https://mainnet.base.org').trim()
  return raw || 'https://mainnet.base.org'
}

async function rpcCall(method: string, params: any[], timeoutMs = 5000) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const r = await fetch(rpcUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    })
    const data: any = await r.json().catch(() => ({}))
    if (data?.error) throw new Error(data.error.message || 'RPC error')
    return data?.result ?? null
  } finally {
    clearTimeout(t)
  }
}

function touchesCreditContract(receipt: any): boolean {
  if (String(receipt?.to || '').toLowerCase() === CREDIT_CONTRACT) return true
  const logs: any[] = Array.isArray(receipt?.logs) ? receipt.logs : []
  return logs.some((log) => String(log?.address || '').toLowerCase() === CREDIT_CONTRACT)
}

/**
 * Polls RPC for receipt until found or timeout.
 * Runs entirely server-side — frontend makes ONE request and waits.
 * Base confirms in ~1-2s with Alchemy, so 15s is more than enough.
 */
async function waitForReceiptRpc(txHash: string, timeoutMs = 15000, pollMs = 500) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const receipt = await rpcCall('eth_getTransactionReceipt', [txHash], 4000)
      if (receipt) return receipt
    } catch {
      // RPC error on this attempt — keep trying
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  return null
}

// ─── BaseScan (secondary fast-path for already-confirmed txns) ────────────────

async function checkBaseScan(userAddress: string, txHash: string): Promise<'confirmed' | 'failed' | 'not_found'> {
  const apiKey = process.env.BASESCAN_API_KEY || ''
  const keyParam = apiKey ? `&apikey=${encodeURIComponent(apiKey)}` : ''

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 4000)
  try {
    const url =
      `https://api.basescan.org/api?module=account&action=txlist` +
      `&address=${encodeURIComponent(userAddress.toLowerCase())}` +
      `&page=1&offset=10&sort=desc${keyParam}`

    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal })
    if (!r.ok) return 'not_found'

    const data: any = await r.json().catch(() => null)
    if (!data || data.status === '0') return 'not_found'

    const txns: any[] = Array.isArray(data.result) ? data.result : []
    for (const tx of txns) {
      if (String(tx.hash || '').toLowerCase() !== txHash.toLowerCase()) continue
      const success = String(tx.isError || '0') === '0' && String(tx.txreceipt_status || '1') !== '0'
      if (!success) return 'failed'
      if (String(tx.to || '').toLowerCase() === CREDIT_CONTRACT) return 'confirmed'
      // Smart wallet — need RPC to check logs
      return 'not_found'
    }
    return 'not_found'
  } finally {
    clearTimeout(t)
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

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
  if (!isTxHash(txHash)) return json(res, 400, { error: 'Invalid transaction hash' })

  const userAddress = String(body?.address || '').trim()

  try {
    const current = await getOrCreateUser(userId)

    if (await txAlreadyCounted(txHash)) {
      return json(res, 200, { ok: true, alreadyCounted: true, credits: current.credits, txHash })
    }

    // ── Fast path: BaseScan lookup (works if tx already indexed, ~0-2s lag) ──
    if (isAddress(userAddress)) {
      try {
        const scanResult = await checkBaseScan(userAddress, txHash)
        if (scanResult === 'confirmed') {
          await markTxCounted(txHash)
          await incrementMetric(userId, 'txCount', 1, 1)
          const updated = await adjustCredits(userId, +1)
          return json(res, 200, { ok: true, credits: updated.credits, txHash, method: 'basescan' })
        }
        if (scanResult === 'failed') {
          return json(res, 400, { error: 'Transaction failed onchain', txHash, credits: current.credits })
        }
      } catch { /* BaseScan unavailable — fall through */ }
    }

    // ── Main path: RPC polling (server loops until confirmed, max 15s) ────────
    // Frontend makes ONE request and waits here. No frontend polling loop needed.
    const receipt = await waitForReceiptRpc(txHash)

    if (!receipt) {
      // Still not confirmed after 15s — rare on Base with Alchemy
      // Return pending so frontend can retry once more
      return json(res, 202, { ok: true, pending: true, credits: current.credits, txHash })
    }

    const status = String(receipt?.status || '')
    if (status === '0x0' || status === '0') {
      return json(res, 400, { error: 'Transaction failed onchain', txHash, credits: current.credits })
    }

    if (!touchesCreditContract(receipt)) {
      return json(res, 400, {
        error: 'Transaction did not touch the credit contract',
        txHash,
        credits: current.credits,
      })
    }

    await markTxCounted(txHash)
    await incrementMetric(userId, 'txCount', 1, 1)
    const updated = await adjustCredits(userId, +1)
    return json(res, 200, { ok: true, credits: updated.credits, txHash, method: 'rpc' })

  } catch (e: any) {
    return json(res, 500, { error: e?.message || 'Failed to verify transaction' })
  }
}
