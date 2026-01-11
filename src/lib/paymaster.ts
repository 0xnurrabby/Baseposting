/**
 * Paymaster & capabilities helpers for Base / Farcaster mini-app environments.
 *
 * - Ensures Paymaster URL is absolute (webview-safe).
 * - Uses object form for dataSuffix (Farcaster provider is strict).
 */

export function getPaymasterUrl(): string | null {
  const envUrl = (import.meta as any).env?.VITE_PAYMASTER_URL as string | undefined
  const raw = (envUrl && envUrl.trim()) || '/api/paymaster'
  if (!raw) return null

  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw

  const origin =
    typeof window !== 'undefined' && window.location && window.location.origin ? window.location.origin : ''
  if (!origin) return raw

  const path = raw.startsWith('/') ? raw : `/${raw}`
  return `${origin}${path}`
}

export function buildWalletSendCallsCapabilities(opts: {
  dataSuffix?: string | null
  paymasterUrl?: string | null
}): any | undefined {
  const caps: any = {}

  const ds = opts.dataSuffix?.trim()
  if (ds) {
    // Farcaster provider expects capabilities.dataSuffix to be an object.
    caps.dataSuffix = { dataSuffix: ds }
  }

  const pm = opts.paymasterUrl?.trim()
  if (pm) {
    caps.paymasterService = { url: pm }
  }

  return Object.keys(caps).length ? caps : undefined
}

// Backwards-compatible alias (some older commits import the old name).
export const buildWalletCapabilities = buildWalletSendCallsCapabilities

export function isMethodNotSupportedError(e: any): boolean {
  const msg = String(e?.message || e || '').toLowerCase()
  return (
    e?.code === -32601 ||
    msg.includes('does not support') ||
    msg.includes('not support') ||
    msg.includes('unsupported method') ||
    msg.includes('method not found') ||
    msg.includes('unknown method')
  )
}
