export const maxDuration = 15

import crypto from 'node:crypto'
import { adjustCredits, getOrCreateUser, incrementMetric, getRecent, pushRecent } from './_lib/store.js'
import { logCreditSpend } from './_lib/leaderboard.js'
import { handleOptions, json, readJson, requirePost, setCors } from './_lib/http.js'

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

type StyleDeck = {
  id: string
  label: string
  // SHORT format guide (saves prompt tokens)
  formatGuide: string
  weight: number
  maxTokens: number
  maxChars: number
}

// Drastically shortened style definitions — less prompt overhead
const STYLE_DECK: StyleDeck[] = [
  { id: 'one-liner', label: 'dry one-liner', formatGuide: '1-2 lines, punchline at end', weight: 1.0, maxTokens: 70, maxChars: 220 },
  { id: 'micro-story', label: 'tiny story', formatGuide: '3-4 short lines, calm takeaway', weight: 1.0, maxTokens: 100, maxChars: 320 },
  { id: 'checklist', label: 'checklist', formatGuide: '3-4 lines starting with "-"', weight: 0.85, maxTokens: 110, maxChars: 360 },
  { id: 'contrast', label: 'then/now', formatGuide: 'Then→ / Now→ in 2-3 lines', weight: 0.9, maxTokens: 100, maxChars: 320 },
  { id: 'question-hook', label: 'question hook', formatGuide: 'question, then 2-3 lines, call for replies', weight: 0.75, maxTokens: 110, maxChars: 360 },
]

const SL0P_PHRASES = ['unlock', 'game changer', 'revolutionize', 'wagmi', "don't sleep on"]

const TOPIC_TAGS: Array<{ tag: string; keywords: string[] }> = [
  { tag: 'onchain-social', keywords: ['farcaster', 'cast', 'frames', 'miniapp', 'social'] },
  { tag: 'builders', keywords: ['build', 'ship', 'dev', 'sdk', 'deploy'] },
  { tag: 'fees-speed', keywords: ['fee', 'gas', 'cheap', 'fast', 'finality'] },
  { tag: 'defi', keywords: ['defi', 'swap', 'liquidity', 'stablecoin'] },
  { tag: 'nft-creator', keywords: ['nft', 'mint', 'creator', 'collect'] },
  { tag: 'onboarding', keywords: ['onboard', 'new', 'wallet', 'bridge'] },
]

// Keep cache LONG — Apify data doesn't change much
const APIFY_CACHE_TTL_MS = 1000 * 60 * 15 // 15 minutes
let apifyCache: { ts: number; items: any[] } | null = null

// ⚡ PRE-WARM: kick off an Apify fetch at module load (no cold penalty on first request)
let apifyPrewarmPromise: Promise<any> | null = null

const BANNED_OPENERS = ['gm', 'hot take', 'unpopular opinion', 'thread']

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
    '\n\nThis is why Base clicks.',
    '\n\nBase just makes this easy.',
    '\n\nAll on Base 💙',
  ]
  return text.trimEnd() + suffixes[Math.floor(Math.random() * suffixes.length)]
}

async function fetchApifyPostsInner(limit: number) {
  const datasetId = process.env.APIFY_DATASET_ID
  const token = process.env.APIFY_TOKEN
  if (!datasetId || !token) return []

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 1800) // aggressive timeout
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

async function fetchApifyPosts(limit: number) {
  const now = Date.now()
  if (apifyCache && now - apifyCache.ts < APIFY_CACHE_TTL_MS && apifyCache.items.length) {
    return apifyCache.items.slice(0, limit)
  }
  // If there is an in-flight prewarm, await it
  if (apifyPrewarmPromise) {
    try {
      await apifyPrewarmPromise
      if (apifyCache && apifyCache.items.length) {
        return apifyCache.items.slice(0, limit)
      }
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

// ⚡ Trigger prewarm at module load (runs once per serverless instance)
try {
  apifyPrewarmPromise = fetchApifyPostsInner(50).then((arr) => {
    apifyCache = { ts: Date.now(), items: arr }
    return arr
  }).catch(() => null)
} catch {
  // ignore
}

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

function pickSourcePosts(
  posts: Array<{ author: string; text: string }>,
  topicTag: string,
  limit: number
) {
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

function fastLocalGenerate(args: {
  posts: Array<{ author: string; text: string }>
  style: StyleDeck
  topicTag: string
}) {
  const corpus = args.posts.map((p) => p.text).join(' ').toLowerCase()
  const has = (words: string[]) => words.some((w) => corpus.includes(w))

  let cue = 'shipping without overthinking'
  if (has(['fee', 'gas', 'cheap'])) cue = 'low fees'
  else if (has(['fast', 'finality'])) cue = 'fast feedback loops'
  else if (has(['farcaster', 'cast', 'social'])) cue = 'onchain posts that feel native'
  else if (has(['wallet', 'onboard'])) cue = 'getting people onchain smoothly'
  else if (has(['defi', 'swap'])) cue = 'moving capital without friction'

  const lines = [
    `What works on Base: ${cue}.`,
    'The small experiments finally feel worth doing.',
    'Less friction, more building 💙',
  ]
  return clampChars(lines.join('\n'), args.style.maxChars)
}

async function openaiChatWithTimeout(body: any, apiKey: string, timeoutMs: number) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(t)
  }
}

async function openaiGenerate(args: {
  posts: Array<{ author: string; text: string }>
  style: StyleDeck
  topicTag: string
  recentTexts: string[]
  extraPrompt: string
}) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return fastLocalGenerate(args)

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

  // ⚡ MUCH SMALLER prompts — this is the biggest speed win
  const sourceBlock = args.posts
    .slice(0, 6) // was 10-12 — cutting by 40% saves tokens & latency
    .map((p) => `- ${p.text.slice(0, 180)}`) // trim each source post too
    .join('\n')

  const recentBlock = args.recentTexts.slice(0, 2) // was 3-4
    .map((t) => `- ${t.slice(0, 120)}`)
    .join('\n')

  // ⚡ Compact system prompt (was ~500 words, now ~80 words)
  const system = `You write one Farcaster/X post for the Base L2 ecosystem. Feel human, specific, clever. Rules:
- Mention "Base" naturally once.
- Format: ${args.style.formatGuide}.
- Topic: ${args.topicTag}.
- No em-dashes, use "..." instead.
- No hype phrases: ${SL0P_PHRASES.join(', ')}.
- Max 0-2 emojis.
- Output ONLY the post, no quotes/labels.`

  const user = `Inspiration (don't copy):
${sourceBlock || '(none)'}${recentBlock ? `\n\nRecent (avoid repeating):\n${recentBlock}` : ''}${args.extraPrompt ? `\n\nExtra: ${args.extraPrompt.slice(0, 200)}` : ''}

Write one post now.`

  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 1.0,
    presence_penalty: 0.5,
    frequency_penalty: 0.3,
    max_tokens: args.style.maxTokens,
  }

  let resp: Response
  try {
    // ⚡ AGGRESSIVE 8s timeout — if OpenAI slow, fall back to local immediately
    resp = await openaiChatWithTimeout(body, apiKey, 8000)
  } catch {
    return fastLocalGenerate(args)
  }

  if (!resp.ok) return fastLocalGenerate(args)

  const jsonResp: any = await resp.json().catch(() => null)
  const out = String(jsonResp?.choices?.[0]?.message?.content || '').trim()
  if (!out) return fastLocalGenerate(args)

  const cleaned = clampChars(postProcessOutput(out), args.style.maxChars)

  const lower = cleaned.toLowerCase().trim()
  for (const opener of BANNED_OPENERS) {
    if (lower.startsWith(opener)) {
      return postProcessOutput(`Noticed something: ${cleaned}`)
    }
  }

  return cleaned
}

export default async function handler(req: any, res: any) {
  setCors(req, res)
  if (handleOptions(req, res)) return
  if (!requirePost(req, res)) return

  try {
    let body: any = {}
    try {
      body = await readJson(req)
    } catch {
      return json(res, 400, { error: 'Invalid JSON body' })
    }

    const userId = toUserId(body)
    if (!userId) return json(res, 400, { error: 'Missing user identity (fid or address)' })

    const extraPrompt = String(body?.prompt || '').slice(0, 300)
    const limit = Math.max(1, Math.min(200, Number(body?.limit || 50)))

    const user = await getOrCreateUser(userId)
    if (user.credits < 3) {
      return json(res, 402, { error: 'Not enough credits (need 3)', credits: user.credits })
    }

    let charged = false
    try {
      // ⚡ PARALLEL: fetch apify + recent simultaneously (already fast via cache)
      const [apifyItems, recent] = await Promise.all([
        fetchApifyPosts(limit),
        getRecent(userId, 'post', 6).catch(() => []), // was 12 — we only need a few for dedupe
      ])

      const posts = normalizePosts(apifyItems, 20)

      const recentStyleIds = recent.map((r) => String(r?.styleId || '')).filter(Boolean)
      const recentTags = recent.map((r) => String(r?.topicTag || '')).filter(Boolean)
      const recentTexts = recent
        .map((r) => String(r?.text || '').trim())
        .filter(Boolean)
        .slice(0, 2)

      const usedStyle = pickStyle(recentStyleIds.slice(0, 3))
      const usedTopicTag = pickTopicTag(posts, recentTags.slice(0, 4))

      const chosenSources = pickSourcePosts(
        posts.map((p) => ({ author: p.author, text: p.text })),
        usedTopicTag,
        6
      )

      // ⚡ Single OpenAI call, 8s timeout, lean prompt
      let text = await openaiGenerate({
        posts: chosenSources,
        style: usedStyle,
        topicTag: usedTopicTag,
        recentTexts,
        extraPrompt,
      })

      text = ensureBaseMention(text)

      // Re-fetch credits to double-check
      const latest = await getOrCreateUser(userId)
      if (latest.credits < 3) {
        return json(res, 402, { error: 'Not enough credits (need 3)', credits: latest.credits })
      }

      const after = await adjustCredits(userId, -3)
      charged = true

      // ⚡ Fire-and-forget background tasks — doesn't block response
      Promise.all([
        pushRecent(userId, 'post', { ts: Date.now(), styleId: usedStyle.id, topicTag: usedTopicTag, text }, 12).catch(() => {}),
        incrementMetric(userId, 'postCount', 1, 2).catch(() => {}),
        logCreditSpend({ userId, creditsSpent: 3, postDelta: 1 }).catch(() => {}),
      ]).catch(() => {})

      return json(res, 200, {
        ok: true,
        text,
        credits: after.credits,
        sourceCount: posts.length,
        format: usedStyle.id,
        topic: usedTopicTag,
      })
    } catch (e: any) {
      if (charged) {
        try { await adjustCredits(userId, +3) } catch { /* ignore */ }
      }
      return json(res, 500, { error: e?.message || 'Generation failed' })
    }
  } catch (e: any) {
    return json(res, 500, { error: e?.message || 'Server error' })
  }
}
