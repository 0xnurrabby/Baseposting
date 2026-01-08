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
}

export async function initMiniApp(): Promise<MiniAppState> {
  // Detect if we're in a Mini App context
  const isInMiniApp = await sdk.isInMiniApp()

  let capabilities: string[] = []
  try {
    capabilities = await sdk.getCapabilities()
  } catch {
    // ignore
  }

  // Call ready() ASAP once UI is mounted (this function is called after first render)
  try {
    await sdk.actions.ready()
  } catch {
    // ignore
  }

  let user: MiniAppUser | null = null
  if (isInMiniApp) {
    try {
      const ctx: any = await sdk.context
      if (ctx?.user) user = ctx.user
    } catch {
      // ignore
    }
  }

  return { isInMiniApp, capabilities, user }
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

export async function composeCast(args: { text: string; embeds?: string[]; channelKey?: string }) {
  return await sdk.actions.composeCast({
    text: args.text,
    embeds: args.embeds,
    channelKey: args.channelKey,
  })
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

export async function getEthereumProvider() {
  // Prefer the Mini App wallet provider when available, but fall back to an injected
  // provider (e.g. Base app / Coinbase Wallet / browser wallet) when the host
  // doesn't expose wallet capabilities.
  try {
    const isInMiniApp = await sdk.isInMiniApp()
    if (isInMiniApp) {
      const caps = await sdk.getCapabilities().catch(() => [])
      if (Array.isArray(caps) && caps.includes('wallet.getEthereumProvider')) {
        // Some Mini App hosts can hang here; timeout keeps UI responsive.
        return await withTimeout(sdk.wallet.getEthereumProvider(), 8000, 'Wallet provider timed out')
      }
    }
  } catch {
    // ignore and fall through to injected provider
  }

  const anyWin = window as any
  if (anyWin?.ethereum) return anyWin.ethereum

  throw new Error('No wallet provider found. Open inside Warpcast/Base app or use a wallet-enabled browser.')
}
