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

function normalizeWalletName(provider: any, fallback = 'Browser Wallet') {
  if (provider?.isTrust || provider?.isTrustWallet) return 'Trust Wallet'
  if (provider?.isRabby) return 'Rabby Wallet'
  if (provider?.isMetaMask) return 'MetaMask'
  if (provider?.isCoinbaseWallet) return 'Coinbase Wallet'
  if (provider?.isOKXWallet || provider?.okxwallet) return 'OKX Wallet'
  if (provider?.isBraveWallet) return 'Brave Wallet'
  const infoName = provider?.info?.name || provider?.providerInfo?.name || provider?.name
  if (typeof infoName === 'string' && infoName.trim()) return infoName.trim()
  return fallback
}

function walletPriority(name: string) {
  const lower = String(name || '').toLowerCase()
  if (lower.includes('base')) return 100
  if (lower.includes('coinbase')) return 95
  if (lower.includes('trust')) return 92
  if (lower.includes('metamask')) return 90
  if (lower.includes('rabby')) return 88
  if (lower.includes('okx')) return 86
  if (lower.includes('brave')) return 80
  return 60
}

function dedupeWallets(items: WalletOption[]) {
  const seen = new Set<string>()
  const out: WalletOption[] = []
  for (const item of items.sort((a, b) => b.priority - a.priority)) {
    const key = `${item.source}:${String(item.name || '').toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
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
    capabilities = await sdk.getCapabilities()
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
  if (capabilities.includes('haptics.selectionChanged')) {
    try {
      await sdk.haptics.selectionChanged()
    } catch {
      // ignore
    }
  }
}

export async function hapticImpact(capabilities: string[], style: 'light' | 'medium' | 'heavy' = 'medium') {
  if (capabilities.includes('haptics.impactOccurred')) {
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
          : provider?.isCoinbaseWallet
            ? 'Base App Wallet'
            : providerName === 'Coinbase Wallet'
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

  const anyWin = window as any
  const eth = anyWin?.ethereum
  const injectedProviders = Array.isArray(eth?.providers) && eth.providers.length ? eth.providers : eth ? [eth] : []

  injectedProviders.forEach((provider: any, idx: number) => {
    const name = normalizeWalletName(provider)
    out.push({
      id: `injected:${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}:${idx}`,
      name,
      provider,
      source: 'injected',
      priority: walletPriority(name),
    })
  })

  return dedupeWallets(out)
}

export async function getEthereumProvider(preferredId?: string, opts: { isInMiniApp?: boolean; client?: any } = {}) {
  const wallets = await listAvailableWallets(opts)
  const preferred = wallets.find((w) => w.id === preferredId)
  if (preferred?.provider) return preferred.provider
  if (wallets[0]?.provider) return wallets[0].provider
  throw new Error('No wallet provider found. Open in a wallet-enabled browser or use the Base / Farcaster app.')
}
