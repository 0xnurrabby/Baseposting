import { handleOptions, json, readJson, requirePost, setCors } from './_lib/http.js'

// Vercel Serverless Function
// Proxies Paymaster/Bundler JSON-RPC requests to Coinbase Developer Platform (CDP)
// so the API key never leaks to the client.
//
// Vercel env (required):
//   PAYMASTER_AND_BUNDLER_ENDPOINT = https://api.developer.coinbase.com/rpc/v1/base/<YOUR_KEY>

export default async function handler(req: any, res: any) {
  // CORS + preflight
  if (handleOptions(req, res)) return
  setCors(req, res)

  if (!requirePost(req, res)) return

  const endpoint = process.env.PAYMASTER_AND_BUNDLER_ENDPOINT
  if (!endpoint) {
    return json(res, 500, {
      error: 'PAYMASTER_AND_BUNDLER_ENDPOINT is not set on the server.',
    })
  }

  let body: any
  try {
    body = await readJson(req)
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' })
  }

  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body ?? {}),
    })

    const text = await upstream.text()
    res.status(upstream.status)
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    return res.send(text)
  } catch (e: any) {
    return json(res, 502, {
      error: 'Paymaster proxy request failed',
      detail: String(e?.message || e),
    })
  }
}
