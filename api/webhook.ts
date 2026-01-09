import { parseWebhookEvent, verifyAppKeyWithNeynar } from '@farcaster/miniapp-node'
import { getRedisClient } from './_lib/store.js'
import { handleOptions, json, setCors } from './_lib/http.js'
import { disableNotifications, pushEvent, upsertNotificationDetails } from './_lib/notifications.js'

function makeVerifier() {
  const apiKey = process.env.NEYNAR_API_KEY

  // Base docs show passing `verifyAppKeyWithNeynar` directly.
  // Some examples call it with an API key and get a verifier function back.
  // We support both styles.
  let verifier: any = verifyAppKeyWithNeynar as any
  if (apiKey) {
    try {
      const maybe = (verifyAppKeyWithNeynar as any)(apiKey)
      if (typeof maybe === 'function') verifier = maybe
    } catch {
      // ignore and fall back
    }
  }

  return verifier
}

export default async function handler(req: any, res: any) {
  setCors(req, res)
  if (handleOptions(req, res)) return

  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method Not Allowed' })
  }

  // NOTE: Base/Farcaster expects a fast 200 response here.
  // Do minimal work, store, and return.
  let bodyText = ''
  try {
    bodyText = await new Promise<string>((resolve, reject) => {
      let data = ''
      req.on('data', (chunk: any) => (data += chunk))
      req.on('end', () => resolve(data))
      req.on('error', reject)
    })
  } catch {
    return json(res, 400, { ok: false, error: 'Unable to read body' })
  }

  const redis = getRedisClient()
  if (!redis) return json(res, 500, { ok: false, error: 'Redis not configured' })

  let parsed: any
  try {
    // parseWebhookEvent accepts either JSON string or object; we pass the raw string for max compatibility.
    parsed = await parseWebhookEvent(bodyText, makeVerifier())
  } catch (e: any) {
    const msg = String(e?.message || e || 'Invalid signature')
    // 401 helps you debug "webhook not storing tokens" issues.
    return json(res, 401, { ok: false, error: msg })
  }

  const evtType = String(parsed?.event || parsed?.type || 'unknown')
  await pushEvent(redis, { ts: Date.now(), type: evtType, data: parsed })

  try {
    // Common event shapes:
    // - { event: "notifications_enabled", notificationDetails: { fid, appFid, token, url } }
    // - { event: "notifications_disabled", notificationDetails: { fid, appFid } }
    const details = parsed?.notificationDetails
    if (evtType === 'notifications_enabled' && details) {
      await upsertNotificationDetails(redis, Number(details.fid), Number(details.appFid), {
        token: String(details.token),
        url: String(details.url),
      })
    }
    if (evtType === 'notifications_disabled' && details) {
      await disableNotifications(redis, Number(details.fid), Number(details.appFid))
    }
  } catch (e) {
    // Don't fail the webhook response if storage fails; but log the failure.
    console.error('webhook storage error', e)
  }

  return json(res, 200, { ok: true })
}
