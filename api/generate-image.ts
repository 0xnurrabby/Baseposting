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
  // Imagen prompts are English-only. We avoid copying the post verbatim (prevents accidental text in image).
  const base = postText.replace(/\s+/g, ' ').trim().slice(0, 520)

  return [
    'Create ONE premium, attention-grabbing image for a social post about the Base (Ethereum L2) ecosystem.',
    'The image must look like a high-end product/brand campaign: clean, modern, and instantly clickable.',
    'Pick ONE clear hero subject that visually represents the post idea (e.g., glowing smartphone UI, futuristic builder desk, neon network nodes, sleek city night, abstract but readable “speed/scale” motif).',
    'Style: photorealistic or ultra-clean 3D render (choose whichever fits best), cinematic lighting, sharp focus, studio quality.',
    'Palette: Base-like electric/cobalt blue accents + deep blacks + soft whites. No Base logo.',
    'Composition: strong center subject, depth, subtle bokeh, high contrast, lots of detail but not messy.',
    'Hard rules (must obey): NO text, NO captions, NO letters/numbers, NO logos, NO watermarks, NO UI text, NO brand marks, NO posters/signs.',
    'Aspect ratio 4:3.',
    '',
    'Post meaning (for inspiration only; DO NOT render any words):',
    base ? `- ${base}` : '- (no context provided)',
  ].join('\n')
}

async function rewritePromptWithGemini(postText: string) {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim()
  if (!apiKey) throw new Error('Server missing GEMINI_API_KEY')

  const model = String(process.env.PROMPT_MODEL || 'gemini-1.5-flash').trim()
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`

  // We ask Gemini to convert the post idea into a concrete, visually strong image concept.
  // Output MUST be an English image prompt only (no markdown, no quotes), 70-120 words.
  const instruction = [
    'You are an expert prompt engineer for image generation.',
    'Turn the following social post idea into ONE concrete, high-quality image prompt.',
    'Goal: make a premium, attractive image that fits the Base (Ethereum L2) ecosystem vibe.',
    'Constraints:',
    '- Output ONLY the final image prompt in English (no markdown, no bullet list, no quotes).',
    '- 70-120 words.',
    '- Must describe a clear hero SUBJECT (a real object) + scene + lighting + camera/composition.',
    '- Strong preference: photorealistic product photography OR ultra-clean premium 3D render that looks like product photography.',
    '- Make it look like an Apple / high-end tech brand campaign: minimal, premium, instantly clickable.',
    '- Must include Base-like cobalt/electric blue accents (no Base logo).',
    '- Absolutely NO text/letters/numbers/logos/watermarks/signage in the image (including screens/UI).',
    '- Avoid abstract wire spikes, random neon streaks, messy geometry. Choose tangible, clean visuals.',
    '- Good default hero objects: sleek smartphone on a stand with glowing blue UI shapes (no readable text), laptop on a clean desk, futuristic chip/network module, holographic cube, minimal neon city reflection.',
    '',
    'Post idea:',
    postText.trim().slice(0, 900),
  ].join('\n')

  const body = {
    contents: [{ role: 'user', parts: [{ text: instruction }] }],
    generationConfig: {
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 256,
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
    throw new Error(`Prompt rewrite error: ${r.status} ${text}`)
  }

  const data: any = await r.json()
  const out = String(data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join('') || '').trim()
  if (!out) throw new Error('Prompt rewrite returned empty')
  return out
}

async function generateImagen(prompt: string) {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim()
  if (!apiKey) throw new Error('Server missing GEMINI_API_KEY')

  // Default to Imagen 4 standard. Override via IMAGEN_MODEL if you want.
  const model = String(process.env.IMAGEN_MODEL || 'imagen-4.0-generate-001').trim()

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:predict`
  const tryRequest = async (imageSize: string) => {
    const body = {
      instances: [{ prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: '4:3',
        // We strongly prefer NOT generating people for this product-style imagery.
        personGeneration: 'dont_allow',
        imageSize,
      },
    }

    return fetch(url, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  }

  // Prefer higher detail if supported; fall back gracefully.
  const preferredSize = String(process.env.IMAGE_SIZE || '2K').trim() || '2K'
  let r = await tryRequest(preferredSize)
  if (!r.ok && preferredSize !== '1K') {
    // Some tiers/models may not support 2K; retry at 1K.
    r = await tryRequest('1K')
  }

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
    // Gemini app tends to produce better images because it "thinks" into a concrete visual concept.
    // We replicate that by rewriting the post into a strong image prompt first.
    let prompt = ''
    try {
      const rewritten = await rewritePromptWithGemini(postText)
      prompt = [
        rewritten,
        '',
        'Hard rules: no text, no captions, no letters/numbers, no logos, no watermarks, no signage.',
      ].join('\n')
    } catch {
      // Fallback prompt if rewriting fails.
      prompt = buildPrompt(postText)
    }

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
