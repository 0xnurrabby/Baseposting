import crypto from 'node:crypto'
import { adjustCredits, getOrCreateUser, getRedisClient } from './_lib/store.js'
import { handleOptions, json, readJson, requirePost, setCors } from './_lib/http.js'
import { generateImageWithPollinations } from './_lib/gemini-image.js'

const COST_IMAGE = 5
const IMAGE_TTL_SECONDS = 60 * 60 * 48 // 48h

function toUserId(body: any) {
  const fid = body?.fid
  const address = body?.address
  if (typeof fid === 'number' && Number.isFinite(fid)) return `fid:${fid}`
  if (typeof fid === 'string' && fid.trim() && !Number.isNaN(Number(fid))) return `fid:${Number(fid)}`
  if (typeof address === 'string' && address.startsWith('0x') && address.length >= 42)
    return `addr:${address.toLowerCase()}`
  return null
}

function baseUrl(req: any) {
  const explicit = process.env.PUBLIC_SITE_URL
  if (explicit) return explicit.replace(/\/$/, '')

  const vercel = process.env.VERCEL_URL
  if (vercel) return `https://${vercel}`

  const proto = (req?.headers?.['x-forwarded-proto'] as string) || 'https'
  const host = (req?.headers?.['x-forwarded-host'] as string) || req?.headers?.host
  return `${proto}://${host}`
}

function buildPromptFromPostText(postText: string) {
  const cleaned = String(postText || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[#@]\S+/g, '')
    .trim()

  return (
    `Create a high-quality, visually striking image that matches this social post. ` +
    `No text, no logos, no watermarks. ` +
    `Style: clean, modern, vibrant, suitable for a crypto/Base community post. ` +
    `Post: "${cleaned.slice(0, 400)}"`
  )
}

export default async function handler(req: any, res: any) {
  // ✅ FIX 1: must pass (req, res)
  setCors(req, res)

  if (handleOptions(req, res)) return

  // ✅ FIX 2: must pass res + stop execution if not POST
  if (!requirePost(req, res)) return

  try {
    const body = await readJson(req)
    const userId = toUserId(body)
    if (!userId) return json(res, 400, { ok: false, error: 'Missing identity (fid or address)' })

    const text = String(body?.text || '').trim()
    if (!text) return json(res, 400, { ok: false, error: 'Missing text' })

    const user = await getOrCreateUser(userId)
    if (user.credits < COST_IMAGE) {
      return json(res, 402, { ok: false, error: 'No credits left', credits: user.credits })
    }

    // Charge upfront
    const charged = await adjustCredits(userId, -COST_IMAGE)

    try {
      const prompt = buildPromptFromPostText(text)
      const img = await generateImageWithImagen(prompt)

      const id = crypto.randomUUID?.() || crypto.randomBytes(16).toString('hex')

      const redis = getRedisClient()
      if (!redis) {
        // Refund if Redis isn't configured
        await adjustCredits(userId, COST_IMAGE)
        return json(res, 500, { ok: false, error: 'Image storage is not configured (missing Redis)' })
      }

      await redis.set(`bpimg:${id}`, JSON.stringify({ b64: img.b64, mimeType: img.mimeType }), {
        ex: IMAGE_TTL_SECONDS,
      })

      const url = `${baseUrl(req)}/api/image?id=${encodeURIComponent(id)}`
      return json(res, 200, { ok: true, imageUrl: url, credits: charged.credits })
    } catch (e: any) {
      // Refund on failure
      const refunded = await adjustCredits(userId, COST_IMAGE)
      const status = Number(e?.status) || 500
      const message = e?.message || 'Image generation failed'
      return json(res, status, { ok: false, error: message, credits: refunded.credits })
    }
  } catch (e: any) {
    return json(res, 400, { ok: false, error: e?.message || 'Invalid request body' })
  }
}
