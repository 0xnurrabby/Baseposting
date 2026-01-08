export default function handler(req: any, res: any) {
  try {
  // Domain MUST exactly match the FQDN where this is hosted.
  const domain = 'baseposting.online'

  const header = process.env.FARCASTER_ACCOUNT_ASSOCIATION_HEADER || ''
  const payload = process.env.FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD || ''
  const signature = process.env.FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE || ''

  const manifest = {
    accountAssociation: {
      header,
      payload,
      signature,
    },
    miniapp: {
      version: '1',
      name: 'BasePosting',
      subtitle: 'Base bangers, instantly',
      description: 'Scrape the latest X posts via Apify and generate unique Base-focused bangers with GPT.',
      primaryCategory: 'utility',
      tags: ['base', 'crypto', 'writing', 'ai', 'social'],
      homeUrl: 'https://baseposting.online/',
      iconUrl: 'https://baseposting.online/assets/icon-1024.png',
      splashImageUrl: 'https://baseposting.online/assets/splash-200.png',
      splashBackgroundColor: '#0B0F14',
      ogTitle: 'BasePosting',
      ogDescription: 'Scrape X → generate Base bangers.',
      ogImageUrl: 'https://baseposting.online/assets/og-1200x630.png',

      // Deprecated fields still used by some surfaces + required by this build spec.
      imageUrl: 'https://baseposting.online/assets/embed-3x2.png',
      buttonTitle: 'Open BasePosting',

      // Base Mainnet (CAIP-2)
      requiredChains: ['eip155:8453'],

      // We keep requiredCapabilities empty to avoid hosts refusing to render.
      // requiredCapabilities: ['actions.ready', 'actions.composeCast', 'wallet.getEthereumProvider'],

      canonicalDomain: domain,
    },
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=600')
  res.status(200).send(JSON.stringify(manifest, null, 2))
  } catch (e: any) {
    console.error(e)
    try {
      res.setHeader('Cache-Control', 'no-store')
    } catch {}
    const msg = String(e?.message || e)
    try {
      res.status(500).send(JSON.stringify({ error: 'Server error', detail: msg }))
    } catch {
      // last resort
    }
  }
}
