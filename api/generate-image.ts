import { adjustCredits, getOrCreateUser } from './_lib/store.js'
import { handleOptions, json, readJson, requirePost, setCors } from './_lib/http.js'
import { putImage } from './_lib/image-store.js'
import { put as putBlob } from '@vercel/blob'
import crypto from 'node:crypto'

function toUserId(body: any) {
  const fid = body?.fid
  const address = body?.address
  if (typeof fid === 'number' && Number.isFinite(fid)) return `fid:${fid}`
  if (typeof fid === 'string' && fid.trim() && !Number.isNaN(Number(fid))) return `fid:${Number(fid)}`
  if (typeof address === 'string' && address.startsWith('0x') && address.length >= 42) return `addr:${address.toLowerCase()}`
  return null
}

function buildPrompt(postText: string) {
  // Imagen prompts are English-only. Keep it tight and highly descriptive.
  const base = postText
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 420)

  return [
    'Create a single high-quality image that matches the vibe of a crypto / Base ecosystem post.',
    'Make it visually striking, modern, and professional. Minimal, premium aesthetic.',
    'Use a clean color palette with Base-like electric blue accents (no logo), deep blacks, and whites.',
    'Theme ideas: onchain builders, Layer 2 networks, speed/scale, futuristic city lights, abstract blockchain geometry, optimistic energy.',
    'IMPORTANT: Do not include ANY text, captions, letters, numbers, logos, or watermarks in the image.',
    '',
    'Post vibe/context (inspiration, do not render text):',
    base ? `- ${base}` : '- (no text provided)',
  ].join('\n')
}

async function generateImagen(prompt: string) {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim()
  if (!apiKey) throw new Error('Server missing GEMINI_API_KEY')

  // Default to Imagen 4 standard. Override via IMAGEN_MODEL if you want.
  const model = String(process.env.IMAGEN_MODEL || 'imagen-4.0-generate-001').trim()

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:predict`
  const body = {
    instances: [{ prompt }],
    parameters: {
      sampleCount: 1,
      aspectRatio: '4:3',
      personGeneration: 'allow_adult',
      imageSize: '1K',
    },
  }

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`Imagen error: ${r.status} ${text}`)
  }

  const data: any = await r.json()
  const pred = data?.predictions?.[0]
  const bytesBase64Encoded = String(pred?.bytesBase64Encoded || '').trim()
  const mimeType = String(pred?.mimeType || 'image/png').trim() || 'image/png'
  if (!bytesBase64Encoded) throw new Error('Imagen returned empty image')

  return { bytesBase64Encoded, mimeType }
}

async function maybeUploadToBlob(mimeType: string, bytesBase64Encoded: string) {
  // If deployed on Vercel, the most reliable cross-instance storage for generated images
  // is Vercel Blob. It also returns a public URL that Farcaster can embed.
  const token = String(process.env.BLOB_READ_WRITE_TOKEN || '').trim()
  if (!token) return null

  const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'png'
  const filename = `baseposting/${crypto.randomUUID()}.${ext}`
  const buf = Buffer.from(bytesBase64Encoded, 'base64')

  const result = await putBlob(filename, buf, {
    access: 'public',
    contentType: mimeType || 'image/png',
    token,
  })

  return result?.url || null
}

export default async function handler(req: any, res: any) {
  setCors(req, res)
  if (handleOptions(req, res)) return
  if (!requirePost(req, res)) return

  let body: any = {}
  try {
    body = await readJson(req)
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' })
  }

  const userId = toUserId(body)
  if (!userId) return json(res, 400, { error: 'Missing user identity (fid or address)' })

  const postText = String(body?.text || '').trim().slice(0, 1200)
  if (!postText) return json(res, 400, { error: 'Missing post text' })

  const user = await getOrCreateUser(userId)
  if (user.credits < 5) {
    return json(res, 402, { error: 'Not enough credits', credits: user.credits })
  }

  // Charge 5 credits up-front; refund on failure.
  await adjustCredits(userId, -5)

  try {
    const prompt = buildPrompt(postText)
    const img = await generateImagen(prompt)
    // Prefer durable storage (Vercel Blob) so the image is available on ALL devices/instances.
    // If not configured, fall back to Redis/in-memory (dev only).
    const blobUrl = await maybeUploadToBlob(img.mimeType, img.bytesBase64Encoded)
    let imageUrl = ''
    let imageId = ''
    if (blobUrl) {
      imageUrl = blobUrl
      imageId = ''
    } else {
      const saved = await putImage({ mimeType: img.mimeType, bytesBase64Encoded: img.bytesBase64Encoded })
      imageId = saved.id
      // Return a relative URL and let the client build an absolute URL from its own origin.
      imageUrl = `/api/image?id=${encodeURIComponent(saved.id)}`
    }

    const after = await getOrCreateUser(userId)

    return json(res, 200, {
      ok: true,
      imageUrl,
      imageId,
      credits: after.credits,
    })
  } catch (e: any) {
    // Refund
    await adjustCredits(userId, +5)
    return json(res, 500, { error: e?.message || 'Image generation failed' })
  }
}
