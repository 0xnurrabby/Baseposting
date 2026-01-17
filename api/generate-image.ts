import { adjustCredits, getOrCreateUser, incrementMetric } from './_lib/store.js'
import { logCreditSpend } from './_lib/leaderboard.js'
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
  // Keep the prompt SIMPLE so the model can be creative.
  // We only enforce the two non-negotiables: (1) no text, (2) 4:3 aspect ratio (set in config).
  const base = postText.replace(/\s+/g, ' ').trim().slice(0, 520)

  return [
    'Generate ONE stunning, scroll-stopping image that complements the post below.',
    'Style: modern, cinematic, high-detail (photorealistic or tasteful 3D render).',
    'Make it feel exciting and alive (rich lighting, depth, dynamic composition) — not sterile.',
    'Avoid generic “product packshot” looks. Prefer a creative scene or visual metaphor inspired by the post.',
    'If relevant, lean into a Base / onchain builder vibe (futuristic L2 energy) but keep it subtle and tasteful.',
    'IMPORTANT: Do NOT include any text, captions, letters, numbers, logos, or watermarks.',
    'If a screen is shown, it must contain ONLY abstract shapes/patterns (no readable UI text).',
    '',
    'Post (for inspiration only, do not render any text):',
    base ? base : '(empty)',
  ].join('\n')
}

async function generateWithFallback(prompt: string) {
  // Preferred model can be overridden via IMAGEN_MODEL.
  // If it fails (quota/permission), we fall back to a cheaper image model automatically.
  const preferred = String(process.env.IMAGEN_MODEL || 'imagen-4.0-generate-001').trim()

  const tryOne = async (m: string) => {
    if (m.startsWith('gemini-')) {
      // For Nano Banana models we re-use generateNanoBanana, but temporarily override the model.
      const old = process.env.IMAGEN_MODEL
      process.env.IMAGEN_MODEL = m
      try {
        return await generateNanoBanana(prompt)
      } finally {
        process.env.IMAGEN_MODEL = old
      }
    }
    const old = process.env.IMAGEN_MODEL
    process.env.IMAGEN_MODEL = m
    try {
      return await generateImagen(prompt)
    } finally {
      process.env.IMAGEN_MODEL = old
    }
  }

  try {
    return await tryOne(preferred)
  } catch (e: any) {
    // Fallback order (safe defaults)
    const msg = String(e?.message || '')
    // If a Nano Banana Pro model is selected but blocked, fall back to Flash Image.
    if (preferred.includes('gemini-3-pro-image')) {
      try {
        return await tryOne('gemini-2.5-flash-image')
      } catch (e2) {
        // last resort: Imagen
        return await tryOne('imagen-4.0-generate-001')
      }
    }
    // If any other model fails, last resort: Imagen
    if (msg.includes('403') || msg.includes('429') || msg.toLowerCase().includes('quota')) {
      return await tryOne('imagen-4.0-generate-001')
    }
    throw e
  }
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

async function generateNanoBanana(prompt: string) {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim()
  if (!apiKey) throw new Error('Server missing GEMINI_API_KEY')

  const model = String(process.env.IMAGEN_MODEL || 'gemini-2.5-flash-image').trim()

  // REST format per Gemini API docs: :generateContent + generationConfig.imageConfig
  // https://ai.google.dev/gemini-api/docs/image-generation
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`

  const imageSize = model.includes('gemini-3-pro-image') ? '2K' : '1K'

  const body = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      imageConfig: {
        aspectRatio: '4:3',
        imageSize,
      },
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
    throw new Error(`Nano Banana error: ${r.status} ${text}`)
  }

  const data: any = await r.json()
  const parts = data?.candidates?.[0]?.content?.parts || []
  const inline = parts.find((p: any) => p?.inlineData?.data)
  const bytesBase64Encoded = String(inline?.inlineData?.data || '').trim()
  const mimeType = String(inline?.inlineData?.mimeType || 'image/png').trim() || 'image/png'
  if (!bytesBase64Encoded) throw new Error('Nano Banana returned empty image')

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
    const model = String(process.env.IMAGEN_MODEL || 'imagen-4.0-generate-001').trim()
    const img = model.startsWith('gemini-') ? await generateNanoBanana(prompt) : await generateImagen(prompt)
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

    // Count successful image generations for admin stats.
    await incrementMetric(userId, 'photoCount', 1, 3)
    // Leaderboard metric: credits spent + photo count.
    await logCreditSpend({ userId, creditsSpent: 5, photoDelta: 1 })

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
