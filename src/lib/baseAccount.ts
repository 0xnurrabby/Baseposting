import { createBaseAccountSDK } from '@base-org/account'

export type BaseAccountConnectResult = {
  provider: any
  address: string
}

let _provider: any | null = null

function normalizeUrl(u: string) {
  if (!u) return ''
  return u.endsWith('/') ? u.slice(0, -1) : u
}

export async function connectBaseAccount(opts: {
  appName: string
  appLogoUrl?: string
  chainIds?: number[]
}): Promise<BaseAccountConnectResult> {
  const sdk = createBaseAccountSDK({
    appName: opts.appName,
    appLogoUrl: opts.appLogoUrl || '',
    appChainIds: opts.chainIds || [8453],
  })

  const provider = sdk.getProvider()
  _provider = provider

  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[]
  const address = (accounts?.[0] || '').toString()
  if (!address) throw new Error('No Base Account address returned')

  return { provider, address }
}

export function getCachedBaseAccountProvider() {
  return _provider
}
