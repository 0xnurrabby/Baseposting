import { handleOptions, json, readJson, requirePost, setCors } from './_lib/http.js'

/**
 * Paymaster + Bundler proxy
 *
 * Keeps PAYMASTER_AND_BUNDLER_ENDPOINT off the client.
 * Forwards JSON-RPC requests to CDP RPC endpoint (Base).
 */
export default async function handler(req: any, res: any) {
  setCors(req, res)
  if (handleOptions(req, res)) return
  if (!requirePost(req, res)) return

  const endpoint = process.env.PAYMASTER_AND_BUNDLER_ENDPOINT
  if (!endpoint) {
    return json(res, 500, {
      error: 'Missing env var PAYMASTER_AND_BUNDLER_ENDPOINT',
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
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
    })

    const text = await upstream.text()
    // Forward status code; if upstream isn't JSON, still return it as text.
    res.statusCode = upstream.status
    res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json')
    return res.end(text)
  } catch (e: any) {
    return json(res, 500, {
      error: 'Paymaster proxy failed',
      detail: String(e?.message || e),
    })
  }
}
