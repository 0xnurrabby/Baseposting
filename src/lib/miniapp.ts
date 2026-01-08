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
      // Different hosts surface the user under different keys.
      const maybe = ctx?.user || ctx?.interactor || ctx?.viewer || null
      const fidRaw = maybe?.fid ?? ctx?.fid ?? ctx?.interactor?.fid ?? ctx?.viewer?.fid
      const fid = Number(fidRaw)
      if (maybe || Number.isFinite(fid)) {
        user = {
          ...(maybe || {}),
          fid: Number.isFinite(fid) ? fid : undefined,
        }
      }
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

export async function getEthereumProvider() {
  // Some clients can hang here if wallet isn't available; add a timeout.
  const timeoutMs = 6000
  return await Promise.race([
    sdk.wallet.getEthereumProvider(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Wallet provider unavailable in this client. Open in Warpcast/Base app.')), timeoutMs)),
  ])
}
