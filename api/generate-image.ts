import { adjustCredits, getOrCreateUser } from './_lib/store.js'
import { handleOptions, json, readJson, requirePost, setCors } from './_lib/http.js'
import { newImageId, putImage } from './_lib/imageStore.js'

function toUserId(body: any) {
  const fid = body?.fid
  const address = body?.address
  if (typeof fid === 'number' && Number.isFinite(fid)) return `fid:${fid}`
  if (typeof fid === 'string' && fid.trim() && !Number.isNaN(Number(fid))) return `fid:${Number(fid)}`
  if (typeof address === 'string' && address.startsWith('0x') && address.length >= 42) return `addr:${address.toLowerCase()}`
  return null
}

function buildPrompt(postText: string) {
  const cleaned = String(postText || '').trim()
  const theme = [
    'Theme: Base (Coinbase incubated Ethereum L2) builder vibe, onchain, optimistic, modern.',
    'Image style: high-quality, professional, social-media friendly, eye-catching.',
    'Composition: bold, minimal, futuristic abstract shapes, subtle blockchain/network motifs.',
    'Colors: Base/crypto aesthetic (deep blues, electric accents, clean whites), strong contrast.',
    'CRITICAL: NO TEXT, NO LETTERS, NO NUMBERS, NO LOGOS, NO WATERMARKS, NO CAPTIONS.',
    'Do not place any typography on the image under any circumstance.',
  ].join('\n')

  // Use the post as inspiration, but do not literally render text.
  const inspiration = cleaned ? `Inspiration (do NOT write this as text): ${cleaned}` : 'Inspiration: Base ecosystem and builder energy.'

  return `${theme}\n\n${inspiration}\n\nReturn a single square image.`
}

async function openaiImage(prompt: string): Promise<{ mime: string; b64: string }> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('Server missing OPENAI_API_KEY')

  const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1'
  const size = process.env.OPENAI_IMAGE_SIZE || '1024x1024'

  const body: any = {
    model,
    prompt,
    size,
    n: 1,
    // Keep it simple; many runtimes support this format.
    response_format: 'b64_json',
  }

  const resp = await fetch('https://api.openai.com/v1/images', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    throw new Error(`OpenAI image error: ${resp.status} ${t}`)
  }

  const data: any = await resp.json()
  const b64 = String(data?.data?.[0]?.b64_json || '').trim()
  if (!b64) throw new Error('OpenAI returned empty image')

  return { mime: 'image/png', b64 }
}

export default async function handler(req: any, res: any) {
  if (handleOptions(req, res)) return
  setCors(req, res)
  requirePost(req, res)

  const body = await readJson(req)
  const userId = toUserId(body)
  if (!userId) return json(res, 400, { error: 'Missing identity (fid or address)' })

  const postText = String(body?.text || '').trim()
  if (!postText) return json(res, 400, { error: 'Missing text' })

  const user = await getOrCreateUser(userId)
  if (user.credits < 5) {
    return json(res, 402, { error: 'Not enough credits', credits: user.credits })
  }

  // Charge 5 credits up-front; refund on failure.
  await adjustCredits(userId, -5)

  try {
    const prompt = buildPrompt(postText)
    const img = await openaiImage(prompt)

    const id = newImageId()
    await putImage({ id, mime: img.mime, b64: img.b64, ttlSeconds: 60 * 60 * 24 * 14 }) // 14 days

    const updated = await getOrCreateUser(userId)
    return json(res, 200, { ok: true, imageId: id, credits: updated.credits })
  } catch (e: any) {
    // Refund
    await adjustCredits(userId, +5)
    return json(res, 500, { error: e?.message || 'Image generation failed' })
  }
}
