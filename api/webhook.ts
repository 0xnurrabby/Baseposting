import { parseWebhookEvent, verifyAppKeyWithNeynar } from '@farcaster/miniapp-node'
import { getRedisClient } from './_lib/store.js'
import { handleOptions, json, setCors } from './_lib/http.js'
import { disableNotifications, pushEvent, upsertNotificationDetails } from './_lib/notifications.js'

type ParsedWebhookData = {
  fid: number
  appFid: number
  event: {
    event: 'miniapp_added' | 'miniapp_removed' | 'notifications_enabled' | 'notifications_disabled' | string
    notificationDetails?: {
      token: string
      url: string
    }
  }
}

function makeVerifier() {
  const apiKey = process.env.NEYNAR_API_KEY

  // Base docs: parseWebhookEvent(requestJson, verifyAppKeyWithNeynar)
  // Some setups use verifyAppKeyWithNeynar(apiKey) -> function
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

async function readRawBody(req: any): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    let data = ''
    req.on('data', (chunk: any) => (data += chunk))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

export default async function handler(req: any, res: any) {
  setCors(req, res)
  if (handleOptions(req, res)) return

  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method Not Allowed' })
  }

  // NOTE: Base app waits for successful webhook response before activating tokens,
  // so keep this handler fast. :contentReference[oaicite:2]{index=2}
  let bodyText = ''
  try {
    bodyText = await readRawBody(req)
  } catch {
    return json(res, 400, { ok: false, error: 'Unable to read body' })
  }

  const redis = getRedisClient()
  if (!redis) return json(res, 500, { ok: false, error: 'Redis not configured' })

  // Try parse JSON, but keep raw-string fallback (some hosts send as string)
  let bodyJson: any = null
  try {
    bodyJson = JSON.parse(bodyText)
  } catch {
    bodyJson = null
  }

  let data: ParsedWebhookData
  try {
    // Base docs pass request JSON object; spec payload is {header,payload,signature}. :contentReference[oaicite:3]{index=3}
    data = (await parseWebhookEvent(bodyJson ?? bodyText, makeVerifier())) as any
  } catch (e: any) {
    const msg = String(e?.message || e || 'Invalid signature')
    return json(res, 401, { ok: false, error: msg })
  }

  const fid = Number(data?.fid)
  const appFid = Number(data?.appFid)
  const event = data?.event
  const evtType = String(event?.event || 'unknown')
  const details = event?.notificationDetails

  // log event (optional)
  try {
    await pushEvent(redis, { ts: Date.now(), type: evtType, data: { fid, appFid, event } })
  } catch {
    // ignore logging failures
  }

  try {
    switch (evtType) {
      // Farcaster spec: miniapp_added can include notificationDetails (token/url). :contentReference[oaicite:4]{index=4}
      case 'miniapp_added':
      // Base docs: notifications_enabled also includes token/url. :contentReference[oaicite:5]{index=5}
      case 'notifications_enabled': {
        if (details?.token && details?.url) {
          await upsertNotificationDetails(redis, fid, appFid, {
            token: String(details.token),
            url: String(details.url),
          })
        }
        break
      }

      case 'miniapp_removed':
      case 'notifications_disabled': {
        // Spec: disable payload might not include notificationDetails,
        // but parseWebhookEvent gives fid/appFid. :contentReference[oaicite:6]{index=6}
        await disableNotifications(redis, fid, appFid)
        break
      }

      default: {
        // unknown event — do nothing
        break
      }
    }
  } catch (e) {
    // Don't fail webhook response if storage fails
    console.error('webhook storage error', e)
  }

  return json(res, 200, { ok: true })
}
