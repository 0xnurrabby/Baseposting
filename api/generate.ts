export const runtime = 'edge'
export const maxDuration = 30

import { adjustCredits, getOrCreateUser, incrementMetric, getRecent, pushRecent } from './_lib/store.js'
import { logCreditSpend } from './_lib/leaderboard.js'

// ============================================================
// EDGE-COMPATIBLE HELPERS (no Node APIs allowed in Edge runtime)
// ============================================================

const ALLOWED_ORIGINS = new Set([
  'https://baseposting.online',
  'http://localhost:5173',
  'https://warpcast.com',
  'https://app.base.org',
])

function corsHeaders(origin: string) {
  const allow = !origin || origin === 'null' || ALLOWED_ORIGINS.has(origin) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin) || origin.startsWith('http://localhost:')
  return {
    'Access-Control-Allow-Origin': allow && origin && origin !== 'null' ? origin : '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

function toUserId(body: any) {
  const fid = body?.fid
  const address = body?.address
  if (typeof fid === 'number' && Number.isFinite(fid)) return `fid:${fid}`
  if (typeof fid === 'string' && fid.trim() && !Number.isNaN(Number(fid))) return `fid:${Number(fid)}`
  if (typeof address === 'string' && address.startsWith('0x') && address.length >= 42) return `addr:${address.toLowerCase()}`
  return null
}

function pickText(item: any): string {
  return item?.text || item?.fullText || item?.tweetText || item?.content || item?.caption || item?.tweet?.full_text || item?.tweet?.text || ''
}

function pickAuthor(item: any): string {
  return item?.author || item?.authorName || item?.userName || item?.username || item?.user?.name || item?.user?.username || 'unknown'
}

function normalizePosts(items: any[], max: number) {
  const normalized = items
    .map((it) => {
      const text = String(pickText(it) || '').trim()
      if (!text) return null
      return {
        author: String(pickAuthor(it) || 'unknown').trim() || 'unknown',
        text: text.replace(/\s+/g, ' ').trim(),
      }
    })
    .filter(Boolean) as any[]

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

type StyleDeck = {
  id: string
  label: string
  formatGuide: string
  anglePrompts: string[]
  weight: number
  maxTokens: number
  maxChars: number
}

const STYLE_DECK: StyleDeck[] = [
  { id: 'one-liner', label: 'Dry humor one-liner', formatGuide: '1–2 lines. No bullets. No intro paragraph. Punchline is the last line.', anglePrompts: ['small irony', 'deadpan observation', 'subtle flex, but humble'], weight: 1.0, maxTokens: 90, maxChars: 220 },
  { id: 'micro-story', label: 'Tiny story', formatGuide: '3–5 short lines. Story beats. Line breaks matter. End with a calm takeaway.', anglePrompts: ['moment from today', 'builder frustration -> aha', 'small win onchain'], weight: 1.0, maxTokens: 150, maxChars: 360 },
  { id: 'checklist', label: 'Checklist', formatGuide: 'Use 3–5 lines like "-" or "- [ ]". No long paragraphs.', anglePrompts: ['shipping checklist', 'onboarding checklist', 'smart habits'], weight: 0.85, maxTokens: 170, maxChars: 420 },
  { id: 'contrast', label: 'Then vs now', formatGuide: 'Use “Then →” / “Now →” (or similar) 2–4 lines. Very readable. No fluff.', anglePrompts: ['fees', 'ux', 'dev velocity', 'onchain social'], weight: 0.9, maxTokens: 150, maxChars: 360 },
  { id: 'based-notes', label: 'Based notes (rare)', formatGuide: 'Use 2–4 lines like “Jesse🟦: …” “Aneri🟦: …”. Keep it short. No long paragraphs.', anglePrompts: ['two quick observations', 'two lessons', 'two small wins'], weight: 0.25, maxTokens: 160, maxChars: 420 },
  { id: 'question-hook', label: 'Question hook', formatGuide: 'Start with 1 question. Then 2–4 lines. End with a simple call for replies.', anglePrompts: ['favorite Base app category', 'builder tip request', 'what are you watching'], weight: 0.75, maxTokens: 160, maxChars: 420 },
]

const SL0P_PHRASES = ['unlock', 'game changer', 'revolutionize', 'next level', 'the future is here', 'join us', "don't sleep on", 'wagmi']

const TOPIC_TAGS: Array<{ tag: string; keywords: string[] }> = [
  { tag: 'onchain-social', keywords: ['farcaster', 'warpcast', 'cast', 'frames', 'mini app', 'miniapp', 'social'] },
  { tag: 'builders', keywords: ['build', 'builder', 'ship', 'dev', 'sdk', 'api', 'deploy', 'open source'] },
  { tag: 'fees-speed', keywords: ['fee', 'fees', 'gas', 'cheap', 'fast', 'latency', 'finality'] },
  { tag: 'defi', keywords: ['defi', 'dex', 'swap', 'liquidity', 'yield', 'stablecoin', 'perps'] },
  { tag: 'security', keywords: ['hack', 'drain', 'approval', 'revoke', 'scam', 'phish', 'exploit', 'audit'] },
  { tag: 'nft-creator', keywords: ['nft', 'mint', 'creator', 'collect', 'art', 'edition'] },
  { tag: 'culture', keywords: ['meme', 'gm', 'vibes', 'ct', 'timeline', 'lmao', 'lol'] },
  { tag: 'onboarding', keywords: ['onboard', 'new', 'beginner', 'first', 'wallet', 'bridge', 'learn'] },
]

const BANNED_OPENERS = ['gm', 'hot take', 'unpopular opinion', "here's the thing", "let's talk about", 'thread']

// ============================================================
// APIFY — keep cache LONG + pre-warm at module load
// ============================================================

const APIFY_CACHE_TTL_MS = 1000 * 60 * 15 // 15 min
let apifyCache: { ts: number; items: any[] } | null = null
let apifyPrewarmPromise: Promise<any[]> | null = null

async function fetchApifyPostsInner(limit: number): Promise<any[]> {
  const datasetId = (globalThis as any).process?.env?.APIFY_DATASET_ID
  const token = (globalThis as any).process?.env?.APIFY_TOKEN
  if (!datasetId || !token) return []

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 1800)
  try {
    const url = `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&limit=${encodeURIComponent(String(Math.max(limit, 40)))}&token=${encodeURIComponent(token)}`
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal })
    if (!r.ok) throw new Error(`Apify error: ${r.status}`)
    const items = await r.json()
    return Array.isArray(items) ? items : []
  } finally {
    clearTimeout(t)
  }
}

async function fetchApifyPosts(limit: number): Promise<any[]> {
  const now = Date.now()
  if (apifyCache && now - apifyCache.ts < APIFY_CACHE_TTL_MS && apifyCache.items.length) {
    return apifyCache.items.slice(0, limit)
  }
  if (apifyPrewarmPromise) {
    try {
      await apifyPrewarmPromise
      if (apifyCache && apifyCache.items.length) return apifyCache.items.slice(0, limit)
    } catch {
      // ignore
    }
  }
  try {
    const arr = await fetchApifyPostsInner(limit)
    apifyCache = { ts: now, items: arr }
    return arr.slice(0, limit)
  } catch {
    if (apifyCache?.items?.length) return apifyCache.items.slice(0, limit)
    return []
  }
}

// Pre-warm: fires on first module load per edge instance.
try {
  apifyPrewarmPromise = fetchApifyPostsInner(60).then((arr) => {
    apifyCache = { ts: Date.now(), items: arr }
    return arr
  }).catch(() => [])
} catch {
  // ignore
}

// ============================================================
// STYLE / TOPIC PICKING (pure JS, fast)
// ============================================================

function weightedPick<T extends { weight: number }>(items: T[], penalize: Set<string>, idKey: (x: T) => string): T {
  const weights = items.map((s) => (penalize.has(idKey(s)) ? s.weight * 0.2 : s.weight))
  const total = weights.reduce((a, b) => a + b, 0) || 1
  let roll = Math.random() * total
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i]
    if (roll <= 0) return items[i]
  }
  return items[0]
}

function pickStyle(recentIds: string[]): StyleDeck {
  return weightedPick(STYLE_DECK, new Set(recentIds), (s) => s.id)
}

function pickTopicTag(posts: Array<{ text: string }>, recentTags: string[]): string {
  const corpus = posts.map((p) => p.text.toLowerCase()).join(' ')
  const scores = TOPIC_TAGS.map(({ tag, keywords }) => {
    let score = 0
    for (const kw of keywords) if (corpus.includes(kw)) score += 1
    if (recentTags.includes(tag)) score *= 0.3
    return { tag, score }
  })
  scores.sort((a, b) => b.score - a.score)
  const topN = scores.slice(0, 3).filter((s) => s.score > 0)
  if (topN.length === 0) return 'builders'
  return topN[Math.floor(Math.random() * topN.length)].tag
}

function pickSourcePosts(posts: Array<{ author: string; text: string }>, topicTag: string, limit: number) {
  const tagDef = TOPIC_TAGS.find((t) => t.tag === topicTag)
  if (!tagDef) return posts.slice(0, limit)
  const scored = posts.map((p) => {
    const lower = p.text.toLowerCase()
    let score = 0
    for (const kw of tagDef.keywords) if (lower.includes(kw)) score += 1
    return { p, score }
  })
  scored.sort((a, b) => b.score - a.score)
  const picked = scored.slice(0, Math.min(limit, scored.length)).map((s) => s.p)
  if (picked.length < limit) {
    for (const p of posts) {
      if (picked.length >= limit) break
      if (!picked.includes(p)) picked.push(p)
    }
  }
  return picked
}

// ============================================================
// TEXT POST-PROCESSING
// ============================================================

function clampChars(s: string, max: number) {
  const txt = String(s || '').trim()
  if (txt.length <= max) return txt
  const cut = txt.slice(0, max)
  const lastBreak = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  if (lastBreak > max * 0.6) return cut.slice(0, lastBreak + 1).trim()
  return cut.trim()
}

function postProcessOutput(raw: string) {
  let out = String(raw || '').trim()
  if (!out) return out
  out = out.replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1').trim()
  out = out.replace(/—/g, '...').replace(/–/g, '...').replace(/\u2026/g, '...')
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  return out
}

function ensureBaseMention(text: string): string {
  if (/\bbase\b/i.test(text)) return text
  const suffixes = [
    '\n\nFeels good on Base.',
    '\n\nThis is why Base clicks for me.',
    '\n\nBase just makes this easy.',
    '\n\nAll on Base 💙',
  ]
  return text.trimEnd() + suffixes[Math.floor(Math.random() * suffixes.length)]
}

// ============================================================
// OPENAI — STREAMING
// ============================================================

async function openaiStreamCompletion(args: {
  posts: Array<{ author: string; text: string }>
  style: StyleDeck
  topicTag: string
  recentTexts: string[]
  extraPrompt: string
}): Promise<ReadableStream<Uint8Array> | null> {
  const apiKey = (globalThis as any).process?.env?.OPENAI_API_KEY
  if (!apiKey) return null

  const model = (globalThis as any).process?.env?.OPENAI_MODEL || 'gpt-4o-mini'
  const style = args.style
  const angle = style.anglePrompts[Math.floor(Math.random() * style.anglePrompts.length)]
  const seed = crypto.randomUUID()

  const sourceBlock = args.posts
    .slice(0, 12)
    .map((p, i) => `${i + 1}. @${p.author}: ${p.text}`)
    .join('\n')

  const system = [
    'You are writing a single Farcaster/Twitter-style post for the Base ecosystem.',
    'It must feel human-written: specific, a little clever, and NOT like an AI template.',
    'Hard rules:',
    '- The post MUST mention "Base" naturally once (not more than twice).',
    '- Do NOT copy any source post. Do NOT paraphrase too closely.',
    '- Do NOT use long dashes (—/–). Use "..." for pauses.',
    '- Do NOT use generic hype/marketing lines. Avoid obvious AI phrasing.',
    `- Avoid these slop phrases: ${SL0P_PHRASES.join(', ')}.`,
    '- No fake announcements, token launch rumors, made-up metrics, or "insider alpha". Stay truthful and general when unsure.',
    '- Keep emoji use minimal (0–2). Avoid aesthetic/creator/thread emojis (🎨🧵🖌️🖼️✨🪄🌙💫📌📝).',
    '- Output ONLY the post text (no quotes, no labels).',
    '',
    'Base grounding (safe):',
    ...BASE_FACTS.map((x) => `- ${x}`),
  ].join('\n')

  const user = [
    `Variety seed: ${seed}`,
    `Chosen format: ${style.label} (${style.id})`,
    `Formatting constraints: ${style.formatGuide}`,
    `Angle: ${angle}`,
    `Topic focus: ${args.topicTag}`,
    `Banned opening phrases: ${BANNED_OPENERS.join(', ')}`,
    '',
    'Recent posts for this user (avoid repeating):',
    args.recentTexts.length ? args.recentTexts.map((t, i) => `${i + 1}. ${t}`).join('\n') : '(none)',
    '',
    'Source posts from the Apify dataset (inspiration only; do NOT copy):',
    sourceBlock || '(none)',
    '',
    'Extra user context (optional):',
    args.extraPrompt?.trim() ? args.extraPrompt.trim() : '(none)',
    '',
    'Write ONE post now. Requirements:',
    '- It should feel like a real person wrote it.',
    '- It must be clearly about Base by the end, but NOT forced.',
    '- Use the chosen format. If you use bullets/quotes, keep each line short.',
    '- Avoid long paragraphs.',
  ].join('\n')

  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 1.15,
    presence_penalty: 0.7,
    frequency_penalty: 0.35,
    max_tokens: style.maxTokens,
    stream: true, // ⚡ STREAMING ENABLED
  }

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 12000)

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!resp.ok || !resp.body) {
      clearTimeout(t)
      return null
    }

    // Return the raw stream — the handler will parse it
    // DO NOT clear timeout yet — it'll clear when the stream ends
    return resp.body
  } catch {
    clearTimeout(t)
    return null
  }
}

function fastLocalGenerate(args: { posts: Array<{ author: string; text: string }>; style: StyleDeck }): string {
  const corpus = args.posts.map((p) => p.text).join(' ').toLowerCase()
  const has = (words: string[]) => words.some((w) => corpus.includes(w))
  let cue = 'shipping without overthinking every step'
  if (has(['fee', 'fees', 'gas', 'cheap'])) cue = 'low fees'
  else if (has(['fast', 'faster', 'latency', 'finality'])) cue = 'fast feedback loops'
  else if (has(['ship', 'builder', 'build'])) cue = 'shipping small things quickly'
  else if (has(['farcaster', 'cast', 'social'])) cue = 'onchain posts that feel native'
  else if (has(['wallet', 'onboard'])) cue = 'getting people onchain without drama'
  else if (has(['defi', 'swap', 'liquidity'])) cue = 'moving capital without extra friction'

  const lines = [
    `What actually works on Base: ${cue}.`,
    'The small experiments finally feel worth doing.',
    'Nothing fancy, just less friction 💙',
  ]
  return clampChars(lines.join('\n'), args.style.maxChars)
}

// ============================================================
// HANDLER — streams the response back to frontend
// ============================================================

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin') || ''
  const cors = corsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  let body: any = {}
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const userId = toUserId(body)
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Missing user identity (fid or address)' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const extraPrompt = String(body?.prompt || '').slice(0, 600)
  const limit = Math.max(1, Math.min(200, Number(body?.limit || 50)))

  const user = await getOrCreateUser(userId)
  if (user.credits < 3) {
    return new Response(JSON.stringify({ error: 'Not enough credits (need 3)', credits: user.credits }), {
      status: 402,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  // ⚡ PARALLEL: fetch Apify + user recent simultaneously
  const [apifyItems, recent] = await Promise.all([
    fetchApifyPosts(limit),
    getRecent(userId, 'post', 12).catch(() => []),
  ])

  const posts = normalizePosts(apifyItems, 25)
  const recentStyleIds = recent.map((r: any) => String(r?.styleId || '')).filter(Boolean)
  const recentTags = recent.map((r: any) => String(r?.topicTag || '')).filter(Boolean)
  const recentTexts = recent
    .map((r: any) => String(r?.text || '').trim())
    .filter(Boolean)
    .slice(0, 4)

  const usedStyle = pickStyle(recentStyleIds.slice(0, 3))
  const usedTopicTag = pickTopicTag(posts, recentTags.slice(0, 4))

  const chosenSources = pickSourcePosts(
    posts.map((p: any) => ({ author: p.author, text: p.text })),
    usedTopicTag,
    12
  )

  // Charge credits upfront (before streaming starts)
  const after = await adjustCredits(userId, -3)

  // Fire background metrics (don't await)
  Promise.all([
    incrementMetric(userId, 'postCount', 1, 2).catch(() => {}),
    logCreditSpend({ userId, creditsSpent: 3, postDelta: 1 }).catch(() => {}),
  ]).catch(() => {})

  // Build the stream
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      // Send metadata line first
      controller.enqueue(encoder.encode(JSON.stringify({
        type: 'meta',
        credits: after.credits,
        format: usedStyle.id,
        topic: usedTopicTag,
        sourceCount: posts.length,
      }) + '\n'))

      // Start OpenAI stream
      const openaiStream = await openaiStreamCompletion({
        posts: chosenSources,
        style: usedStyle,
        topicTag: usedTopicTag,
        recentTexts,
        extraPrompt,
      })

      let fullText = ''

      if (!openaiStream) {
        // Fallback: local generation
        const localText = ensureBaseMention(fastLocalGenerate({ posts: chosenSources, style: usedStyle }))
        fullText = localText
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'chunk', text: localText }) + '\n'))
      } else {
        // Parse SSE stream from OpenAI and forward chunks
        const reader = openaiStream.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed || !trimmed.startsWith('data:')) continue
              const data = trimmed.slice(5).trim()
              if (data === '[DONE]') continue
              try {
                const parsed = JSON.parse(data)
                const delta = parsed?.choices?.[0]?.delta?.content
                if (typeof delta === 'string' && delta.length > 0) {
                  fullText += delta
                  controller.enqueue(encoder.encode(JSON.stringify({ type: 'chunk', text: delta }) + '\n'))
                }
              } catch {
                // ignore malformed line
              }
            }
          }
        } catch {
          // stream error
        } finally {
          try { reader.releaseLock() } catch { /* ignore */ }
        }
      }

      // Final processing + ensure "Base" mentioned
      let finalText = postProcessOutput(fullText || fastLocalGenerate({ posts: chosenSources, style: usedStyle }))
      finalText = clampChars(finalText, usedStyle.maxChars)
      finalText = ensureBaseMention(finalText)

      // If post-processing changed the text, send the final version
      if (finalText !== fullText) {
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'final', text: finalText }) + '\n'))
      } else {
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'done', text: finalText }) + '\n'))
      }

      // Fire-and-forget: save recent post for dedup
      pushRecent(userId, 'post', { ts: Date.now(), styleId: usedStyle.id, topicTag: usedTopicTag, text: finalText }, 12).catch(() => {})

      controller.close()
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no', // disable nginx buffering
    },
  })
}
