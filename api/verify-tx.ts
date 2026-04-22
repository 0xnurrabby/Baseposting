export const maxDuration = 60

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

function isTxHash(x: string) {
  return /^0x[a-fA-F0-9]{64}$/.test(x)
}

function rpcUrl() {
  const raw = String(process.env.BASE_RPC_URL || process.env.RPC_URL || 'https://mainnet.base.org').trim()
  return raw || 'https://mainnet.base.org'
}

async function rpc(method: string, params: any[]) {
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

async function waitForReceipt(txHash: string, timeoutMs = 1200, pollMs = 1200) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const receipt = await rpc('eth_getTransactionReceipt', [txHash])
    if (receipt) return receipt
    await new Promise((r) => setTimeout(r, pollMs))
  }
  return null
}

const CREDIT_CONTRACT = '0xb331328f506f2d35125e367a190e914b1b6830cf'

// Accept the tx if EITHER:
//  - tx.to directly equals the credit contract (Trust / MetaMask etc.)
//  - OR any log in the receipt was emitted by the credit contract
//    (Base smart wallet / batched tx path — tx.to is the smart-wallet proxy)
function touchesCreditContract(receipt: any): boolean {
  const toAddr = String(receipt?.to || '').toLowerCase()
  if (toAddr === CREDIT_CONTRACT) return true

  const logs: any[] = Array.isArray(receipt?.logs) ? receipt.logs : []
  for (const log of logs) {
    const a = String(log?.address || '').toLowerCase()
    if (a === CREDIT_CONTRACT) return true
  }

  return false
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
  if (!isTxHash(txHash)) return json(res, 400, { error: 'Invalid transaction hash' })

  try {
    const current = await getOrCreateUser(userId)
    const alreadyCounted = await txAlreadyCounted(txHash)
    if (alreadyCounted) {
      return json(res, 200, { ok: true, alreadyCounted: true, credits: current.credits, txHash })
    }

    const receipt: any = await waitForReceipt(txHash)
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
    return json(res, 200, { ok: true, credits: updated.credits, txHash })
  } catch (e: any) {
    return json(res, 500, { error: e?.message || 'Failed to verify transaction' })
  }
}
