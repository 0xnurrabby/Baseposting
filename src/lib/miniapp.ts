import { sdk } from '@farcaster/miniapp-sdk'

export type MiniAppUser = {
  fid?: number
  username?: string
  displayName?: string
  pfpUrl?: string
}

export type MiniAppState = {
  isInMiniApp: boolean
  capabilities: string[]
  user: MiniAppUser | null
  client: any | null
}

export type WalletOption = {
  id: string
  name: string
  provider: any
  source: 'miniapp' | 'injected'
  priority: number
  rdns?: string
  icon?: string
  providerKey?: string
}

type Eip6963Detail = {
  info?: {
    uuid?: string
    name?: string
    icon?: string
    rdns?: string
  }
  provider?: any
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms)
    p.then((v) => {
      clearTimeout(t)
      resolve(v)
    }).catch((e) => {
      clearTimeout(t)
      reject(e)
    })
  })
}

function safeLower(value: any) {
  return typeof value === 'string' ? value.toLowerCase() : ''
}

function normalizeWalletName(provider: any, fallback = 'Browser Wallet', detail?: Eip6963Detail) {
  const infoName = String(detail?.info?.name || provider?.info?.name || provider?.providerInfo?.name || provider?.name || '').trim()
  const infoLower = safeLower(infoName)

  if (infoLower.includes('okx')) return 'OKX Wallet'
  if (infoLower.includes('rabby')) return 'Rabby Wallet'
  if (infoLower.includes('metamask')) return 'MetaMask'
  if (infoLower.includes('coinbase') || infoLower.includes('base wallet')) return 'Coinbase Wallet'
  if (infoLower.includes('trust')) return 'Trust Wallet'
  if (infoLower.includes('bitget')) return 'Bitget Wallet'
  if (infoLower.includes('brave')) return 'Brave Wallet'
  if (infoName) return infoName

  if (provider?.isTrust || provider?.isTrustWallet) return 'Trust Wallet'
  if (provider?.isBitKeep || provider?.isBitgetWallet) return 'Bitget Wallet'
  if (provider?.isRabby) return 'Rabby Wallet'
  if (provider?.isOKXWallet || provider?.okxwallet) return 'OKX Wallet'
  if (provider?.isMetaMask) return 'MetaMask'
  if (provider?.isCoinbaseWallet) return 'Coinbase Wallet'
  if (provider?.isBraveWallet) return 'Brave Wallet'
  return fallback
}

function walletPriority(name: string, rdns = '') {
  const lower = safeLower(name)
  const rdnsLower = safeLower(rdns)
  const hay = `${lower} ${rdnsLower}`
  if (hay.includes('base') || hay.includes('coinbase')) return 100
  if (hay.includes('trust')) return 96
  if (hay.includes('metamask')) return 94
  if (hay.includes('rabby')) return 92
  if (hay.includes('okx')) return 90
  if (hay.includes('bitget') || hay.includes('bitkeep')) return 88
  if (hay.includes('brave')) return 84
  return 60
}

function providerFingerprint(provider: any, name = '') {
  const flags = [
    provider?.isMetaMask ? 'metamask' : '',
    provider?.isRabby ? 'rabby' : '',
    provider?.isCoinbaseWallet ? 'coinbase' : '',
    provider?.isTrust || provider?.isTrustWallet ? 'trust' : '',
    provider?.isOKXWallet || provider?.okxwallet ? 'okx' : '',
    provider?.isBitKeep || provider?.isBitgetWallet ? 'bitget' : '',
    provider?.isBraveWallet ? 'brave' : '',
  ].filter(Boolean).join('|')
  return [
    safeLower(provider?.rdns),
    safeLower(provider?.providerInfo?.rdns),
    safeLower(name),
    flags,
  ].filter(Boolean).join('::')
}

function dedupeWallets(items: WalletOption[]) {
  const seen = new Set<string>()
  const out: WalletOption[] = []
  for (const item of items.sort((a, b) => b.priority - a.priority)) {
    const key = item.providerKey || `${item.source}:${safeLower(item.rdns || item.name)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

async function requestAccounts(provider: any) {
  if (!provider?.request || typeof provider.request !== 'function') {
    throw new Error('Selected wallet provider is unavailable.')
  }
  const existing = (await provider.request({ method: 'eth_accounts' }).catch(() => [])) as string[]
  if (Array.isArray(existing) && existing[0]) return existing
  return (await provider.request({ method: 'eth_requestAccounts' })) as string[]
}

async function discoverEip6963Wallets(waitMs = 250): Promise<WalletOption[]> {
  const out: WalletOption[] = []
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return out

  const seen = new Set<string>()
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963Detail>)?.detail
    const provider = detail?.provider
    if (!provider) return
    const rdns = String(detail?.info?.rdns || '')
    const uuid = String(detail?.info?.uuid || '')
    const name = normalizeWalletName(provider, 'Browser Wallet', detail)
    const providerKey = providerFingerprint(provider, name) || `${rdns}:${uuid}:${safeLower(name)}`
    if (seen.has(providerKey)) return
    seen.add(providerKey)
    out.push({
      id: `eip6963:${uuid || rdns || safeLower(name).replace(/[^a-z0-9]+/g, '-')}`,
      name,
      provider,
      source: 'injected',
      priority: walletPriority(name, rdns),
      rdns: rdns || undefined,
      icon: typeof detail?.info?.icon === 'string' ? detail.info.icon : undefined,
      providerKey,
    })
  }

  window.addEventListener('eip6963:announceProvider', handler as EventListener)
  try {
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  } finally {
    window.removeEventListener('eip6963:announceProvider', handler as EventListener)
  }
  return out
}

function getLegacyInjectedWallets(existing: WalletOption[] = []): WalletOption[] {
  const out: WalletOption[] = []
  const anyWin = window as any
  const candidates = [
    anyWin?.ethereum,
    ...(Array.isArray(anyWin?.ethereum?.providers) ? anyWin.ethereum.providers : []),
    anyWin?.okxwallet,
    anyWin?.trustwallet,
    anyWin?.bitkeep?.ethereum,
    anyWin?.coinbaseWalletExtension,
  ].filter(Boolean)

  const seen = new Set(existing.map((w) => w.providerKey).filter(Boolean) as string[])

  candidates.forEach((provider: any, idx: number) => {
    const name = normalizeWalletName(provider)
    const providerKey = providerFingerprint(provider, name) || `${safeLower(name)}:${idx}`
    if (seen.has(providerKey)) return
    seen.add(providerKey)
    out.push({
      id: `injected:${safeLower(name).replace(/[^a-z0-9]+/g, '-')}:${idx}`,
      name,
      provider,
      source: 'injected',
      priority: walletPriority(name),
      providerKey,
    })
  })

  return out
}

export async function initMiniApp(): Promise<MiniAppState> {
  let isInMiniApp = false
  try {
    isInMiniApp = await sdk.isInMiniApp()
  } catch {
    isInMiniApp = false
  }

  let capabilities: string[] = []
  try {
    const caps = await sdk.getCapabilities()
    capabilities = Array.isArray(caps) ? caps : []
  } catch {
    capabilities = []
  }

  try {
    if (isInMiniApp) await sdk.actions.ready()
  } catch {
    // ignore
  }

  let user: MiniAppUser | null = null
  let client: any | null = null
  if (isInMiniApp) {
    try {
      const ctx: any = await sdk.context
      if (ctx?.user) user = ctx.user
      if (ctx?.client) client = ctx.client
    } catch {
      // ignore
    }
  }

  return { isInMiniApp, capabilities, user, client }
}

export async function hapticSelection(capabilities: string[]) {
  if (Array.isArray(capabilities) && capabilities.includes('haptics.selectionChanged')) {
    try {
      await sdk.haptics.selectionChanged()
    } catch {
      // ignore
    }
  }
}

export async function hapticImpact(capabilities: string[], style: 'light' | 'medium' | 'heavy' = 'medium') {
  if (Array.isArray(capabilities) && capabilities.includes('haptics.impactOccurred')) {
    try {
      await sdk.haptics.impactOccurred(style)
    } catch {
      // ignore
    }
  }
}

/**
 * Twitter / X share — opens the native X app on mobile (via intent / universal
 * link), or the web composer on desktop. Works in Base app, Trust wallet,
 * Bitget wallet, MetaMask mobile, and regular browsers on all platforms.
 *
 * - Mobile: the OS will offer "X" / "II·X" (clone) app chooser
 * - Desktop: opens https://twitter.com/intent/tweet?... in a new tab
 */
export function shareToTwitter(args: { text: string; url?: string }) {
  const text = String(args.text || '').trim()
  const url = String(args.url || '').trim()

  const intent = new URL('https://twitter.com/intent/tweet')
  if (text) intent.searchParams.set('text', text)
  if (url) intent.searchParams.set('url', url)

  // On mobile, using location.href gives the OS a chance to open the X app
  // via Android intent / iOS universal link. window.open() in a miniapp
  // webview often silently does nothing.
  const ua = String(navigator.userAgent || '').toLowerCase()
  const isMobile = /android|iphone|ipad|ipod|mobile/.test(ua)

  try {
    if (isMobile) {
      // Try opening in a new window first (desktop browsers + some webviews)
      const w = window.open(intent.toString(), '_blank', 'noopener,noreferrer')
      if (!w) {
        // Fallback — navigate current window. The OS will show the app chooser.
        window.location.href = intent.toString()
      }
    } else {
      window.open(intent.toString(), '_blank', 'noopener,noreferrer')
    }
  } catch {
    window.location.href = intent.toString()
  }
}

/**
 * Kept for backward compatibility with share-for-credits flow. This still
 * uses Farcaster composer because that flow is explicitly "share on
 * Farcaster for a bonus". Regular "Post Directly" now uses shareToTwitter.
 */
function buildComposeIntent(args: { text: string; embeds?: string[]; channelKey?: string }) {
  const url = new URL('https://farcaster.xyz/~/compose')
  if (args.text) url.searchParams.set('text', args.text)
  for (const embed of args.embeds || []) {
    if (embed) url.searchParams.append('embeds[]', embed)
  }
  if (args.channelKey) url.searchParams.set('channelKey', args.channelKey)
  return url.toString()
}

export async function composeCast(args: { text: string; embeds?: string[]; channelKey?: string }) {
  let isMiniApp = false
  try {
    isMiniApp = await sdk.isInMiniApp()
  } catch {
    isMiniApp = false
  }

  if (!isMiniApp) {
    const intent = buildComposeIntent(args)
    window.open(intent, '_blank', 'noopener,noreferrer')
    return null
  }

  const p = sdk.actions.composeCast({
    text: args.text,
    embeds: args.embeds,
    channelKey: args.channelKey,
  })

  return await Promise.race([
    p,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 7000)),
  ])
}

export async function listAvailableWallets(args: { isInMiniApp?: boolean; client?: any } = {}): Promise<WalletOption[]> {
  const out: WalletOption[] = []
  const isInMiniApp = Boolean(args.isInMiniApp)

  if (isInMiniApp) {
    try {
      const caps = await sdk.getCapabilities().catch(() => [])
      if (Array.isArray(caps) && caps.includes('wallet.getEthereumProvider')) {
        const provider: any = await withTimeout(sdk.wallet.getEthereumProvider(), 2500, 'Wallet provider timed out')
        const providerName = normalizeWalletName(provider, 'Mini App Wallet')
        const clientFid = Number(args?.client?.clientFid || 0)
        const isWarpcast = clientFid === 9152
        const name = isWarpcast ? 'Warpcast Wallet' : provider?.isCoinbaseWallet || providerName === 'Coinbase Wallet' ? 'Base App Wallet' : providerName
        out.push({
          id: 'miniapp',
          name,
          provider,
          source: 'miniapp',
          priority: walletPriority(name) + 20,
          providerKey: `miniapp:${safeLower(name)}`,
        })
      }
    } catch {
      // ignore
    }
  }

  const eip6963 = await discoverEip6963Wallets()
  const legacy = getLegacyInjectedWallets(eip6963)
  out.push(...eip6963, ...legacy)

  return dedupeWallets(out)
}

export async function getEthereumProvider(preferredId?: string, opts: { isInMiniApp?: boolean; client?: any } = {}) {
  const wallets = await listAvailableWallets(opts)
  const preferred = wallets.find((w) => w.id === preferredId)
  if (preferred?.provider) return preferred.provider
  if (wallets[0]?.provider) return wallets[0].provider
  throw new Error('No wallet provider found. Open in a wallet-enabled browser or use the Base / Farcaster app.')
}

export async function connectWalletProvider(option: WalletOption, _opts: { isInMiniApp?: boolean; client?: any } = {}) {
  const provider = option?.provider
  if (!provider) throw new Error('Selected wallet provider is unavailable.')
  const accounts = await requestAccounts(provider)
  const address = Array.isArray(accounts) ? accounts[0] : null
  if (!address) throw new Error('No wallet account returned')
  return { provider, address }
}
