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

export async function getEthereumProvider() {
  return await sdk.wallet.getEthereumProvider()
}
