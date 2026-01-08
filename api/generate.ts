import crypto from 'node:crypto'
import { adjustCredits, getOrCreateUser } from './_lib/store.js'
import { json, readJson, requirePost } from './_lib/http.js'

function toUserId(body: any) {
  const fid = body?.fid
  const address = body?.address
  if (typeof fid === 'number' && Number.isFinite(fid)) return `fid:${fid}`
  if (typeof fid === 'string' && fid.trim() && !Number.isNaN(Number(fid))) return `fid:${Number(fid)}`
  if (typeof address === 'string' && address.startsWith('0x') && address.length >= 42) return `addr:${address.toLowerCase()}`
  return null
}

function pickText(item: any): string {
  return (
    item?.text ||
    item?.fullText ||
    item?.tweetText ||
    item?.content ||
    item?.caption ||
    item?.tweet?.full_text ||
    item?.tweet?.text ||
    ''
  )
}

function pickAuthor(item: any): string {
  return (
    item?.author ||
    item?.authorName ||
    item?.userName ||
    item?.username ||
    item?.user?.name ||
    item?.user?.username ||
    'unknown'
  )
}

function normalizePosts(items: any[], max: number) {
  const normalized = items
    .map((it) => {
      const text = String(pickText(it) || '').trim()
      if (!text) return null
      return {
        author: String(pickAuthor(it) || 'unknown').trim() || 'unknown',
        text: text.replace(/\s+/g, ' ').trim(),
        createdAt: it?.createdAt || it?.time || it?.timestamp || it?.date || null,
        likeCount: it?.likeCount ?? it?.likes ?? it?.favoriteCount ?? null,
        replyCount: it?.replyCount ?? it?.replies ?? null,
        repostCount: it?.retweetCount ?? it?.reposts ?? it?.quoteCount ?? null,
      }
    })
    .filter(Boolean) as any[]

  // Prefer non-empty unique texts
  const seen = new Set<string>()
  const out: any[] = []
  for (const p of normalized) {
    const key = p.text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
    if (out.length >= max) break
  }
  return out
}

const BASE_FACTS = [
  'Base is an Ethereum Layer 2 (L2) built on the OP Stack and incubated by Coinbase.',
  'Base aims for fast, low-cost transactions and Ethereum-level security.',
  'Base ecosystem includes apps, NFTs, onchain social, and DeFi; avoid naming specific products unless grounded in user/source context.',
  'Do not invent announcements, partnerships, token launches, or metrics. If unsure, speak generally.',
]

const STYLE_SEEDS = [
  'bullish micro-rant',
  'dry humor one-liner',
  'contrarian hot take',
  'builder mindset',
  'meme-y but not cringe',
  'high-signal short alpha',
  'simple analogy',
  'fomo-with-restraint',
]

const BANNED_OPENERS = [
  'gm',
  'hot take',
  'unpopular opinion',
  'here\'s the thing',
  'let\'s talk about',
  'thread',
]

async function fetchApifyPosts(limit: number) {
  const datasetId = process.env.APIFY_DATASET_ID
  const token = process.env.APIFY_TOKEN
  if (!datasetId || !token) {
    throw new Error('Server missing APIFY_DATASET_ID or APIFY_TOKEN')
  }

  const url = `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&limit=${encodeURIComponent(String(limit))}&token=${encodeURIComponent(token)}`
  const r = await fetch(url, { headers: { 'Accept': 'application/json' } })
  if (!r.ok) throw new Error(`Apify error: ${r.status}`)
  const items = await r.json()
  return Array.isArray(items) ? items : []
}

async function openaiGenerate(args: {
  userId: string
  extraPrompt: string
  posts: Array<{ author: string; text: string }>
}) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('Server missing OPENAI_API_KEY')

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

  const seed = crypto.randomUUID()
  const style = STYLE_SEEDS[Math.floor(Math.random() * STYLE_SEEDS.length)]

  const sourceBlock = args.posts
    .slice(0, 12)
    .map((p, i) => `${i + 1}. @${p.author}: ${p.text}`)
    .join('\n')

  const system = [
    'You write like an elite crypto twitter / Farcaster poster.',
    'Goal: craft ONE short post that feels human, clever, and unique (no template vibes).',
    'It must be Base-focused, punchy, natural, and non-cringe. Emojis are tasteful and minimal.',
    'Never hallucinate specific Base ecosystem product claims, launches, metrics, or partnerships. If you cannot verify from provided context, stay general.',
    'Avoid repeating common openers. Avoid cliches and generic motivational fluff.',
    'Output ONLY the final post text. No quotes around it. No hashtags unless truly organic (max 1).',
    '',
    'Static Base facts (safe):',
    ...BASE_FACTS.map((x) => `- ${x}`),
  ].join('\n')

  const user = [
    `Variety seed: ${seed}`,
    `Style seed: ${style}`,
    `Banned opening phrases: ${BANNED_OPENERS.join(', ')}`,
    '',
    'Source posts (inspiration only; do NOT copy, do NOT paraphrase too closely):',
    sourceBlock || '(none)',
    '',
    'User extra context:',
    args.extraPrompt?.trim() ? args.extraPrompt.trim() : '(none)',
    '',
    'Write 1 post now.',
  ].join('\n')

  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 1.05,
    presence_penalty: 0.6,
    frequency_penalty: 0.2,
    max_tokens: 140,
  }

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`OpenAI error: ${resp.status} ${text}`)
  }

  const jsonResp: any = await resp.json()
  const out = String(jsonResp?.choices?.[0]?.message?.content || '').trim()
  if (!out) throw new Error('OpenAI returned empty output')

  // Final safety: avoid banned openers (soft enforcement)
  const lower = out.toLowerCase().trim()
  for (const opener of BANNED_OPENERS) {
    if (lower.startsWith(opener)) {
      // Nudge by adding a subtle prefix to break template feel
      return `Noticed something: ${out}`
    }
  }

  return out
}

export default async function handler(req: any, res: any) {
  if (!requirePost(req, res)) return

  let body: any = {}
  try {
    body = await readJson(req)
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' })
  }

  const userId = toUserId(body)
  if (!userId) return json(res, 400, { error: 'Missing user identity (fid or address)' })

  const extraPrompt = String(body?.prompt || '').slice(0, 600)
  const limit = Math.max(1, Math.min(200, Number(body?.limit || 50)))

  const user = await getOrCreateUser(userId)
  if (user.credits < 1) {
    return json(res, 402, { error: 'Not enough credits', credits: user.credits })
  }

  // Charge 1 credit up-front; refund on failure.
  await adjustCredits(userId, -1)

  try {
    const apifyItems = await fetchApifyPosts(limit)
    const posts = normalizePosts(apifyItems, 25)

    const text = await openaiGenerate({
      userId,
      extraPrompt,
      posts: posts.map((p) => ({ author: p.author, text: p.text })),
    })

    const after = await getOrCreateUser(userId)

    return json(res, 200, {
      ok: true,
      text,
      credits: after.credits,
      sourceCount: posts.length,
    })
  } catch (e: any) {
    // Refund
    await adjustCredits(userId, +1)
    return json(res, 500, { error: e?.message || 'Generation failed' })
  }
}
