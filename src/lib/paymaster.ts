// Paymaster helper for Base Mini Apps
//
// We keep the paymaster URL *absolute* because some Mini App hosts
// change the effective origin (preview surfaces / in-app proxies),
// which can break relative fetches.

const API_ORIGIN =
  import.meta.env.VITE_API_ORIGIN ||
  // Default to the current host where this app is served.
  window.location.origin

function withOrigin(path: string) {
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  return `${API_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`
}

/**
 * Absolute paymaster proxy URL.
 *
 * Default: <API_ORIGIN>/api/paymaster
 * Override (optional): VITE_PAYMASTER_URL
 */
export function getPaymasterServiceUrl() {
  const override = String(import.meta.env.VITE_PAYMASTER_URL || '').trim()
  if (override) return withOrigin(override)
  return withOrigin('/api/paymaster')
}

/**
 * Builds the `capabilities` object for wallet_sendCalls.
 *
 * Includes:
 * - dataSuffix (ERC-8021 builder attribution) when present
 * - paymasterService url (gas sponsorship) when enabled
 */
export function buildWalletCapabilities(args: { dataSuffix?: any; enablePaymaster?: boolean }) {
  const caps: any = {}
  if (args?.dataSuffix) caps.dataSuffix = args.dataSuffix

  const enable = args?.enablePaymaster !== false
  if (enable) {
    const url = getPaymasterServiceUrl()
    if (url) caps.paymasterService = { url }
  }

  return Object.keys(caps).length ? caps : undefined
}
