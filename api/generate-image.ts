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

// Style presets
// - Keep negatives short (too many hard "don't" rules can hurt results).
// - Prefer: describe the scene + then add style cues (instead of huge keyword dumps).
type StylePreset = {
  label: string
  style: string
}

const STYLE_PRESETS: Record<string, StylePreset> = {
  // --- your current best ---
  storybook: {
    label: 'Storybook Watercolor',
    style: [
      "Style: hand-drawn storybook illustration (children's book vibe).",
      'Clean ink outlines, soft watercolor shading, pastel/muted colors, gentle paper texture.',
      'Whimsical medieval fantasy / RPG concept art feel, warm lighting, detailed background.',
      'Slightly isometric/diagonal composition, cozy scene, expressive characters (if any).',
      'Not photorealistic. Not glossy plastic.',
    ].join(' '),
  },

  // --- requested: cinematic / realistic / modern ---
  cinematic: {
    label: 'Cinematic Illustration',
    style: [
      'Style: modern cinematic illustration.',
      'High detail, dramatic lighting, depth of field, dynamic composition, film-like color grading.',
      'Can be tasteful realistic render, but avoid generic product packshot look.',
    ].join(' '),
  },

  realistic: {
    label: 'Photorealistic',
    style: [
      'Style: photorealistic image.',
      'Natural lighting, realistic materials, believable textures, high fidelity details.',
      'Candid composition, not staged studio packshot.',
    ].join(' '),
  },

  modern: {
    label: 'Modern Clean Illustration',
    style: [
      'Style: modern clean digital illustration.',
      'Crisp shapes, subtle gradients, minimal noise, contemporary aesthetic.',
      'Balanced composition, app-friendly, polished look.',
    ].join(' '),
  },

  // --- extra popular styles ---
  anime: {
    label: 'Anime',
    style: [
      'Style: anime illustration.',
      'Clean line art, soft cel shading, expressive character design, vibrant but tasteful colors.',
      'Cinematic framing and clear silhouettes.',
    ].join(' '),
  },

  ghibli: {
    label: 'Cozy Animation Background',
    style: [
      'Style: cozy whimsical animation background.',
      'Soft painterly look, warm gentle light, natural colors, charming details, peaceful mood.',
    ].join(' '),
  },

  watercolor: {
    label: 'Soft Watercolor',
    style: [
      'Style: watercolor painting.',
      'Soft edges, pigment blooms, light washes, paper texture, gentle palette.',
    ].join(' '),
  },

  oil: {
    label: 'Oil Painting',
    style: [
      'Style: oil painting.',
      'Visible brush strokes, rich texture, painterly lighting, museum-quality feel.',
    ].join(' '),
  },

  pencil: {
    label: 'Pencil Sketch',
    style: [
      'Style: pencil sketch.',
      'Cross-hatching, paper grain, monochrome shading, hand-drawn lines.',
    ].join(' '),
  },

  inkwash: {
    label: 'Ink & Wash',
    style: [
      'Style: ink and wash illustration.',
      'Elegant ink lines, expressive brushwork, soft wash shading, textured paper.',
    ].join(' '),
  },

  comic: {
    label: 'Comic / Graphic Novel',
    style: [
      'Style: comic book / graphic novel.',
      'Bold line art, dynamic panels feel, gentle halftone shading, dramatic contrast.',
    ].join(' '),
  },

  pixel: {
    label: 'Pixel Art',
    style: [
      'Style: pixel art (32-bit retro game).',
      'Crisp pixels, limited palette, readable silhouettes, clean dithering.',
    ].join(' '),
  },

  isometric: {
    label: 'Isometric',
    style: [
      'Style: isometric illustration.',
      'Clean geometry, soft shadows, neat edges, modern app-friendly look.',
    ].join(' '),
  },

  flat: {
    label: 'Flat Vector',
    style: [
      'Style: flat vector illustration.',
      'Clean shapes, smooth gradients, minimal texture, crisp modern design.',
    ].join(' '),
  },

  // 3D family
  '3d': {
    label: '3D Render',
    style: [
      'Style: 3D render.',
      'Soft global illumination, realistic shading, clean composition, detailed materials.',
    ].join(' '),
  },

  clay: {
    label: '3D Clay Diorama',
    style: [
      'Style: 3D clay render.',
      'Cute diorama, soft studio lighting, smooth clay materials, charming miniature look.',
    ].join(' '),
  },

  lowpoly: {
    label: 'Low-poly 3D',
    style: [
      'Style: low-poly 3D.',
      'Simple geometry, clean shading, minimal clutter, pleasant lighting.',
    ].join(' '),
  },

  // vibes
  cyberpunk: {
    label: 'Cyberpunk Neon',
    style: [
      'Style: cyberpunk.',
      'Neon glow, rainy night ambience, reflective surfaces, high contrast, futuristic city vibe.',
    ].join(' '),
  },

  vaporwave: {
    label: 'Vaporwave / Synthwave',
    style: [
      'Style: vaporwave / synthwave.',
      'Neon gradients, retro 80s mood, soft glow, dreamy atmosphere.',
    ].join(' '),
  },

  noir: {
    label: 'Film Noir',
    style: [
      'Style: film noir.',
      'Black and white, dramatic shadows, moody lighting, subtle grain, cinematic framing.',
    ].join(' '),
  },

  fantasy: {
    label: 'Fantasy Concept Art',
    style: [
      'Style: fantasy concept art.',
      'Epic atmosphere, detailed environment, painterly lighting, adventurous mood.',
    ].join(' '),
  },

  scifi: {
    label: 'Sci-fi Concept Art',
    style: [
      'Style: sci-fi concept art.',
      'Futuristic design, believable tech details, cinematic light, atmospheric depth.',
    ].join(' '),
  },
}

// aliases (so you can use many env names)
const PRESET_ALIASES: Record<string, string> = {
  // realistic aliases
  photorealistic: 'realistic',
  photo: 'realistic',
  real: 'realistic',

  // cinematic aliases
  movie: 'cinematic',
  film: 'cinematic',

  // modern aliases
  clean: 'modern',
  minimal: 'modern',

  // 3d aliases
  render: '3d',
  '3drender': '3d',

  // storybook aliases
  childrens: 'storybook',
  children: 'storybook',
  rpg: 'storybook',
  medieval: 'storybook',

  // vector aliases
  vector: 'flat',
}

function normalizePresetKey(raw: string) {
  const key = String(raw || '').trim().toLowerCase()
  if (!key) return 'storybook'
  return PRESET_ALIASES[key] || key
}

function pickEnvPresetKey() {
  const presetRaw = String(process.env.PHOTO_STYLE_PRESET || 'storybook')
  const poolRaw = String(process.env.PHOTO_STYLE_POOL || '').trim()

  // If PHOTO_STYLE_POOL is set, we random-pick each request.
  // You can also set PHOTO_STYLE_PRESET with commas as a shortcut.
  const pool = (poolRaw || presetRaw)
    .split(/[,|]/g)
    .map((s) => normalizePresetKey(s))
    .filter((k) => Boolean(k) && Boolean(STYLE_PRESETS[k]))

  const wantsPool = Boolean(poolRaw) || presetRaw.includes(',') || presetRaw.includes('|')
  if (wantsPool && pool.length) {
    // Random across requests
    const idx = crypto.randomInt(0, pool.length)
    return pool[idx]
  }

  // Single preset (or invalid) fallback
  return normalizePresetKey(presetRaw)
}

function buildPrompt(postText: string, userRequestedPreset?: string) {
  // Keep the prompt LIGHT (few rules) to avoid over-constraining the model.
  // We enforce only the non-negotiable: NO TEXT (aspect ratio is enforced by API config).
  const base = postText.replace(/\s+/g, ' ').trim().slice(0, 520)

  // If user selected a style, use it. Otherwise use env default (or random pool).
  const requestedKey = userRequestedPreset ? normalizePresetKey(userRequestedPreset) : ''
  const envKey = pickEnvPresetKey()
  const presetKey = STYLE_PRESETS[requestedKey] ? requestedKey : envKey
  const preset = STYLE_PRESETS[presetKey] || STYLE_PRESETS.storybook

  // optional extra hint (small!)
  const extraHint = String(process.env.PHOTO_STYLE_EXTRA_HINT || '').trim()

  return [
    'Generate ONE image that visually complements the post below.',
    preset.style,
    extraHint ? `Extra hint: ${extraHint}` : '',
    'Rule: Do NOT include any text, captions, letters, numbers, logos, or watermarks.',
    '',
    'Post (inspiration only — do not render as text):',
    base ? base : '(empty)',
  ].filter(Boolean).join('\n')
}

function normalizeModelName(raw: any, fallback: string) {
  const v = String(raw ?? '').trim()
  if (!v) return fallback
  const bad = v.toLowerCase()
  if (bad === 'undefined' || bad === 'null') return fallback
  return v
}

async function generateWithFallback(prompt: string) {
  // IMPORTANT: do NOT mutate process.env on a warm serverless instance.
  // Mutating env can leak across requests and create "models/undefined" errors.
  // We pass model names explicitly instead.

  const preferred = normalizeModelName(process.env.IMAGEN_MODEL, 'imagen-4.0-generate-001')

  const tryOne = async (m: string) => {
    if (m.startsWith('gemini-')) return await generateNanoBanana(prompt, m)
    return await generateImagen(prompt, m)
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
      } catch {
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

async function generateImagen(prompt: string, modelOverride?: string) {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim()
  if (!apiKey) throw new Error('Server missing GEMINI_API_KEY')

  // Default to Imagen 4 standard. Override via IMAGEN_MODEL if you want.
  const model = normalizeModelName(modelOverride ?? process.env.IMAGEN_MODEL, 'imagen-4.0-generate-001')

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

async function generateNanoBanana(prompt: string, modelOverride?: string) {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim()
  if (!apiKey) throw new Error('Server missing GEMINI_API_KEY')

  const model = normalizeModelName(modelOverride ?? process.env.IMAGEN_MODEL, 'gemini-2.5-flash-image')

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

  const stylePreset = typeof body?.stylePreset === 'string' ? String(body.stylePreset).trim() : ''

  const user = await getOrCreateUser(userId)
  if (user.credits < 5) {
    return json(res, 402, { error: 'Not enough credits', credits: user.credits })
  }

  // Charge 5 credits up-front; refund on failure.
  await adjustCredits(userId, -5)

  try {
    const prompt = buildPrompt(postText, stylePreset)

    // Use fallback wrapper (you already wrote it) — safer:
    const img = await generateWithFallback(prompt)

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
