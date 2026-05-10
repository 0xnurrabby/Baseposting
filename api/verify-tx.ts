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

// ─── BaseScan approach (fast, ~1-2s) ─────────────────────────────────────────
//
// Fetches the last 5 transactions from the user's address to the credit contract.
// If the submitted txHash is among them and status=1, we're done.
// No polling needed — BaseScan indexes Base txns within ~1-2s of confirmation.

async function checkViaBasceScan(userAddress: string, txHash: string): Promise<'confirmed' | 'not_found' | 'failed'> {
  const apiKey = process.env.BASESCAN_API_KEY || ''
  const keyParam = apiKey ? `&apikey=${encodeURIComponent(apiKey)}` : ''

  // Query recent normal txns from userAddress to the credit contract
  const url =
    `https://api.basescan.org/api` +
    `?module=account` +
    `&action=txlist` +
    `&address=${encodeURIComponent(userAddress.toLowerCase())}` +
    `&startblock=0` +
    `&endblock=99999999` +
    `&page=1` +
    `&offset=10` +
    `&sort=desc` +
    keyParam

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 5000)
  try {
    const r = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!r.ok) return 'not_found'

    const data: any = await r.json().catch(() => null)
    if (!data || data.status === '0') return 'not_found'

    const txns: any[] = Array.isArray(data.result) ? data.result : []

    for (const tx of txns) {
      const hash = String(tx.hash || '').toLowerCase()
      if (hash !== txHash.toLowerCase()) continue

      // Found the txHash — check it went to (or involves) the credit contract
      const toAddr = String(tx.to || '').toLowerCase()
      const isSuccess = String(tx.isError || '0') === '0' && String(tx.txreceipt_status || '1') !== '0'

      if (!isSuccess) return 'failed'

      // Direct call to credit contract
      if (toAddr === CREDIT_CONTRACT) return 'confirmed'

      // Smart wallet / batch tx — the tx.to is a proxy, but it may have called
      // the credit contract internally. Fall through to RPC check for this case.
      return 'not_found'
    }

    // Also check internal transactions (smart wallet batched calls)
    const internalUrl =
      `https://api.basescan.org/api` +
      `?module=account` +
      `&action=txlistinternal` +
      `&txhash=${encodeURIComponent(txHash)}` +
      keyParam

    const ctrl2 = new AbortController()
    const t2 = setTimeout(() => ctrl2.abort(), 4000)
    try {
      const r2 = await fetch(internalUrl, {
        headers: { Accept: 'application/json' },
        signal: ctrl2.signal,
      })
      if (!r2.ok) return 'not_found'
      const data2: any = await r2.json().catch(() => null)
      const itxns: any[] = Array.isArray(data2?.result) ? data2.result : []
      for (const itx of itxns) {
        const toAddr2 = String(itx.to || '').toLowerCase()
        if (toAddr2 === CREDIT_CONTRACT) {
          const isErr = String(itx.isError || '0') !== '0'
          return isErr ? 'failed' : 'confirmed'
        }
      }
    } finally {
      clearTimeout(t2)
    }

    return 'not_found'
  } finally {
    clearTimeout(t)
  }
}

// ─── RPC fallback ─────────────────────────────────────────────────────────────

function rpcUrl() {
  const raw = String(process.env.BASE_RPC_URL || process.env.RPC_URL || 'https://mainnet.base.org').trim()
  return raw || 'https://mainnet.base.org'
}

async function rpcCall(method: string, params: any[]) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 6000)
  try {
    const r = await fetch(rpcUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    })
    const data: any = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(data?.error?.message || `RPC error (${r.status})`)
    if (data?.error) throw new Error(data.error.message || 'RPC error')
    return data?.result
  } finally {
    clearTimeout(t)
  }
}

function touchesCreditContract(receipt: any): boolean {
  const toAddr = String(receipt?.to || '').toLowerCase()
  if (toAddr === CREDIT_CONTRACT) return true
  const logs: any[] = Array.isArray(receipt?.logs) ? receipt.logs : []
  for (const log of logs) {
    if (String(log?.address || '').toLowerCase() === CREDIT_CONTRACT) return true
  }
  return false
}

async function waitForReceiptRpc(txHash: string, timeoutMs = 7000, pollMs = 700): Promise<any> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const receipt = await rpcCall('eth_getTransactionReceipt', [txHash])
    if (receipt) return receipt
    await new Promise((r) => setTimeout(r, pollMs))
  }
  return null
}

// ─── Main handler ─────────────────────────────────────────────────────────────

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

  // Extract user address from body (needed for BaseScan lookup)
  const userAddress = String(body?.address || '').trim()

  try {
    const current = await getOrCreateUser(userId)

    // Already credited — fast path
    const alreadyCounted = await txAlreadyCounted(txHash)
    if (alreadyCounted) {
      return json(res, 200, { ok: true, alreadyCounted: true, credits: current.credits, txHash })
    }

    // ── Strategy 1: BaseScan address lookup (fast, ~1-2s after confirmation) ──
    if (isAddress(userAddress)) {
      try {
        const scanResult = await checkViaBasceScan(userAddress, txHash)

        if (scanResult === 'confirmed') {
          await markTxCounted(txHash)
          await incrementMetric(userId, 'txCount', 1, 1)
          const updated = await adjustCredits(userId, +1)
          return json(res, 200, { ok: true, credits: updated.credits, txHash, method: 'basescan' })
        }

        if (scanResult === 'failed') {
          return json(res, 400, { error: 'Transaction failed onchain', txHash, credits: current.credits })
        }

        // 'not_found' — tx not yet indexed or is a smart wallet batch, fall through to RPC
      } catch {
        // BaseScan failed (rate limit, network) — fall through to RPC
      }
    }

    // ── Strategy 2: RPC receipt polling (fallback) ────────────────────────────
    const receipt: any = await waitForReceiptRpc(txHash)

    if (!receipt) {
      return json(res, 202, { ok: true, pending: true, credits: current.credits, txHash })
    }

    const statusHex = String(receipt?.status || '')
    if (statusHex === '0x0' || statusHex === '0') {
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
