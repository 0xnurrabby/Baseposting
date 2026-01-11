import { handleOptions, json, setCors } from './_lib/http.js'

export default function handler(req: any, res: any) {
  try {
    setCors(req, res)
    if (handleOptions(req, res)) return

    if (req.method !== 'GET') {
      return json(res, 405, { error: 'Method Not Allowed' })
    }

    // Domain MUST exactly match the FQDN where this is hosted.
    const hostRaw =
      (req?.headers?.['x-forwarded-host'] as string | undefined) ||
      (req?.headers?.host as string | undefined) ||
      'baseposting.online'
    const domain = String(hostRaw).split(',')[0].trim().split(':')[0]

    const header = process.env.FARCASTER_ACCOUNT_ASSOCIATION_HEADER || ''
    const payload = process.env.FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD || ''
    const signature = process.env.FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE || ''

    const manifest = {
      accountAssociation: { header, payload, signature },
      // Keep both keys for broad compatibility across hosts.
      miniapp: {
        version: '1',
        name: 'BasePosting',
        homeUrl: `https://${domain}/`,
        iconUrl: `https://${domain}/assets/icon-1024.png`,
        splashImageUrl: `https://${domain}/assets/splash-200.png`,
        splashBackgroundColor: '#09090b',
        webhookUrl: `https://${domain}/api/webhook`,
      },
      frame: {
        version: 'next',
        name: 'BasePosting',
        homeUrl: `https://${domain}/`,
        iconUrl: `https://${domain}/assets/icon-1024.png`,
        splashImageUrl: `https://${domain}/assets/splash-200.png`,
        splashBackgroundColor: '#09090b',
        webhookUrl: `https://${domain}/api/webhook`,
      },
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).send(JSON.stringify(manifest, null, 2))
  } catch (e: any) {
    console.error(e)
    const msg = String(e?.message || e)
    try {
      json(res, 500, { error: 'Server error', detail: msg })
    } catch {
      // last resort
    }
  }
}
