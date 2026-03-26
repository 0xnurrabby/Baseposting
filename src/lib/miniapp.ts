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
  if (provider?.isTrust || provider?.isTrustWallet) return 'Trust Wallet'
  if (provider?.isRabby) return 'Rabby Wallet'
  if (provider?.isMetaMask) return 'MetaMask'
  if (provider?.isCoinbaseWallet) return 'Coinbase Wallet'
  if (provider?.isOKXWallet || provider?.okxwallet) return 'OKX Wallet'
  if (provider?.isBraveWallet) return 'Brave Wallet'
  const infoName = detail?.info?.name || provider?.info?.name || provider?.providerInfo?.name || provider?.name
  if (typeof infoName === 'string' && infoName.trim()) return infoName.trim()
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
  if (hay.includes('brave')) return 84
  return 60
}

function dedupeWallets(items: WalletOption[]) {
  const byKey = new Map<string, WalletOption>()
  for (const item of items.sort((a, b) => b.priority - a.priority)) {
    const key = item.rdns
      ? `${item.source}:${safeLower(item.rdns)}`
      : `${item.source}:${safeLower(item.name)}`
    if (!byKey.has(key)) byKey.set(key, item)
  }
  return Array.from(byKey.values()).sort((a, b) => b.priority - a.priority)
}

async function requestAccounts(provider: any) {
  if (!provider?.request || typeof provider.request !== 'function') {
    throw new Error('Selected wallet provider is unavailable.')
  }
  const existing = (await provider.request({ method: 'eth_accounts' }).catch(() => [])) as string[]
  if (Array.isArray(existing) && existing[0]) return existing
  return (await provider.request({ method: 'eth_requestAccounts' })) as string[]
}

async function discoverEip6963Wallets(waitMs = 450): Promise<WalletOption[]> {
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
    const key = uuid || `${rdns}:${name}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({
      id: `eip6963:${uuid || rdns || safeLower(name).replace(/[^a-z0-9]+/g, '-')}`,
      name,
      provider,
      source: 'injected',
      priority: walletPriority(name, rdns),
      rdns: rdns || undefined,
      icon: typeof detail?.info?.icon === 'string' ? detail.info.icon : undefined,
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

function getLegacyInjectedWallets(): WalletOption[] {
  const out: WalletOption[] = []
  const anyWin = window as any
  const eth = anyWin?.ethereum
  const injectedProviders = Array.isArray(eth?.providers) && eth.providers.length ? eth.providers : eth ? [eth] : []

  injectedProviders.forEach((provider: any, idx: number) => {
    if (!provider) return
    const name = normalizeWalletName(provider)
    out.push({
      id: `injected:${safeLower(name).replace(/[^a-z0-9]+/g, '-')}:${idx}`,
      name,
      provider,
      source: 'injected',
      priority: walletPriority(name),
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
        const provider = await withTimeout(sdk.wallet.getEthereumProvider(), 5000, 'Wallet provider timed out')
        const providerName = normalizeWalletName(provider, 'Mini App Wallet')
        const clientFid = Number(args?.client?.clientFid || 0)
        const isWarpcast = clientFid === 9152
        const name = isWarpcast
          ? 'Warpcast Wallet'
          : provider?.isCoinbaseWallet || providerName === 'Coinbase Wallet'
            ? 'Base App Wallet'
            : providerName
        out.push({
          id: 'miniapp',
          name,
          provider,
          source: 'miniapp',
          priority: walletPriority(name) + 20,
        })
      }
    } catch {
      // ignore
    }
  }

  const eip6963 = await discoverEip6963Wallets()
  const legacy = getLegacyInjectedWallets()
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

export async function connectWalletProvider(option: WalletOption, opts: { isInMiniApp?: boolean; client?: any } = {}) {
  const provider = await getEthereumProvider(option.id, opts)
  const accounts = await requestAccounts(provider)
  const address = Array.isArray(accounts) ? accounts[0] : null
  if (!address) throw new Error('No wallet account returned')
  return { provider, address }
}
