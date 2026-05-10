export const maxDuration = 30

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
  {
    id: 'one-liner',
    label: 'Dry one-liner or two-liner',
    formatGuide: '1–2 lines max. No bullets, no intro. Reads like a passing thought you actually had. The last line lands on its own.',
    anglePrompts: [
      'something that felt weird until it just worked',
      'a small thing you noticed that others probably missed',
      'irony about how people talk about crypto vs what actually happens',
      'something you used to think was complicated that turned out not to be',
      'a quiet observation about how onchain activity has changed your actual routine',
    ],
    weight: 1.2,
    maxTokens: 80,
    maxChars: 200,
  },
  {
    id: 'micro-story',
    label: 'Personal micro-story',
    formatGuide: '3–5 very short lines. Write like a real person recounting a specific small moment. No summaries. No "takeaway:" labels. The ending is understated, not motivational.',
    anglePrompts: [
      'the moment you realized gas fees actually stopped mattering to you',
      'trying something on Base for the first time and it just working',
      'the difference between explaining crypto to someone last year vs now',
      'something broke, you figured it out, moved on — no drama',
      'a late-night rabbit hole into a Base app that surprised you',
    ],
    weight: 1.1,
    maxTokens: 160,
    maxChars: 380,
  },
  {
    id: 'contrast',
    label: 'Before vs after (personal)',
    formatGuide: 'Use 2–3 short line pairs. Format like: "Before: ..." then "Now: ..." — or "Used to: ..." then "These days: ...". No bullets. Punchy. Reads like personal experience, not a marketing comparison.',
    anglePrompts: [
      'how you thought about L2s before vs after using Base regularly',
      'deploying contracts: what it felt like then vs what it feels like now',
      'checking gas before every transaction vs not thinking about it anymore',
      'what "onchain social" meant to you a year ago vs today',
    ],
    weight: 0.95,
    maxTokens: 140,
    maxChars: 340,
  },
  {
    id: 'raw-take',
    label: 'Raw honest take',
    formatGuide: '2–4 lines. No hedging. Sounds like something you would say to a friend who is also deep in crypto. Not a hot take for engagement — just a real opinion you actually hold.',
    anglePrompts: [
      'why most L2 comparisons miss what actually matters day to day',
      'what Base got right that others overthought',
      'something the Base ecosystem does quietly well that nobody talks about',
      'a misconception about Base that you yourself used to have',
      'why you stopped caring about a specific crypto debate',
    ],
    weight: 1.0,
    maxTokens: 150,
    maxChars: 360,
  },
  {
    id: 'curious-question',
    label: 'Genuine curious question',
    formatGuide: '1 real question you actually have + 1–2 lines of your own thinking on it. NOT engagement bait. You are genuinely curious, not running a poll. Sounds like something you would post on Farcaster at midnight.',
    anglePrompts: [
      'something about builder behavior on Base you have been wondering about',
      'a UX pattern on Base apps that surprised you and you want to understand why',
      'something about how people actually use DeFi on Base day to day',
      'what makes some Base apps get real traction when others with similar ideas never do',
    ],
    weight: 0.8,
    maxTokens: 150,
    maxChars: 360,
  },
]

const SLOP_PHRASES = [
  'unlock', 'game changer', 'revolutionize', 'next level', 'the future is here',
  'join us', "don't sleep on", 'wagmi', 'buidl', 'this is huge', 'massive',
  'exciting', 'thrilled', 'delighted', 'proud to announce', 'breaking',
  'alpha', 'gem', 'ser', 'fren', 'lfg', 'to the moon', 'diamond hands',
  'every percentage saved', 'breaking the bank', 'work wonders', 'nails both', 'secret sauce',
]

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

const BANNED_OPENERS = [
  'gm', 'hot take', 'unpopular opinion', "here's the thing",
  "let's talk about", 'thread', 'just a reminder', 'reminder:',
  'fact:', 'truth:', 'real talk', 'i want to talk about',
  'why do i love', 'let me know what you',
]

// Apify cache — 15 min TTL + pre-warm at module load
const APIFY_CACHE_TTL_MS = 1000 * 60 * 15
let apifyCache: { ts: number; items: any[] } | null = null
let apifyPrewarmPromise: Promise<any[]> | null = null

async function fetchApifyPostsInner(limit: number): Promise<any[]> {
  const datasetId = process.env.APIFY_DATASET_ID
  const token = process.env.APIFY_TOKEN
  if (!datasetId || !token) return []

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 2500)
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
    } catch { /* ignore */ }
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

// Pre-warm at module load
try {
  apifyPrewarmPromise = fetchApifyPostsInner(60).then((arr) => {
    apifyCache = { ts: Date.now(), items: arr }
    return arr
  }).catch(() => [])
} catch { /* ignore */ }

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
    '\n\nHappened on Base, for context.',
    '\n\nAll of this is on Base.',
    '\n\nThis is what Base feels like day to day.',
    '\n\nBase, specifically.',
    '\n\nContext: I was on Base.',
  ]
  return text.trimEnd() + suffixes[Math.floor(Math.random() * suffixes.length)]
}

function fastLocalGenerate(args: { posts: Array<{ author: string; text: string }>; style: StyleDeck }): string {
  const corpus = args.posts.map((p) => p.text).join(' ').toLowerCase()
  const has = (words: string[]) => words.some((w) => corpus.includes(w))

  const fallbacks = [
    "Been using Base almost daily now. The part that actually changed my workflow isn't what I expected.",
    'Deployed something on Base yesterday. Took maybe ten minutes from idea to live. That used to mean something different.',
    "The quiet thing about Base is that it stops being a topic of conversation the moment it just works.",
    "Still find it slightly funny that the chain I thought I'd try once has become the one I actually use.",
    "You stop thinking about fees at some point. That's when it starts feeling like infrastructure.",
    "Something clicked about onchain apps this week that I didn't expect to click.",
  ]

  let pick = fallbacks[Math.floor(Math.random() * fallbacks.length)]

  if (has(['fee', 'fees', 'gas', 'cheap'])) {
    pick = "The moment you stop mentally converting gas to USD before every transaction is the moment it stops feeling like crypto and starts feeling like a tool."
  } else if (has(['ship', 'builder', 'build', 'deploy'])) {
    pick = "Shipped something on Base this week that I kept putting off because I expected it to be annoying. It wasn't."
  } else if (has(['farcaster', 'cast', 'social', 'frames'])) {
    pick = "Onchain social still feels weird to explain to people outside it. From inside it, it already feels normal."
  } else if (has(['defi', 'swap', 'liquidity', 'yield'])) {
    pick = "The DeFi stuff on Base is genuinely usable now. That's a sentence I didn't think I'd be saying without caveats."
  }

  return clampChars(pick, args.style.maxChars)
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
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return fastLocalGenerate(args)

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'
  const style = args.style
  const angle = style.anglePrompts[Math.floor(Math.random() * style.anglePrompts.length)]
  const seed = crypto.randomUUID()

  const sourceBlock = args.posts
    .slice(0, 12)
    .map((p, i) => `${i + 1}. @${p.author}: ${p.text}`)
    .join('\n')

  const system = [
    'You are a real person who is deep in the Base ecosystem — a builder, user, or active community member.',
    'You are writing one post for Twitter/X (or Farcaster). This post will appear on your personal timeline.',
    '',
    'Your voice: direct, occasionally dry, genuinely curious, sometimes a little tired of hype.',
    'You have actually used Base. You notice small things. You do not write like a marketer.',
    '',
    '=== WHAT MAKES A POST FEEL REAL ===',
    '- It comes from a specific observation or moment, not a general statement.',
    '- It does not try to teach anyone. It just says what you noticed or thought.',
    '- It sounds like something you would say in a group chat, not a newsletter.',
    '- It uses normal words. No jargon unless it is specific and intentional.',
    '- It does not wrap up neatly with a lesson or a call to action.',
    '',
    '=== WHAT KILLS AUTHENTICITY — NEVER DO ANY OF THESE ===',
    '- Starting with "Why do I love Base?" or any self-promotional opener.',
    '- Checklist format with "- [ ]" items. Nobody on Twitter posts this.',
    '- Fake dialogue between invented characters (e.g. "Jesse🟦: ... Mika🟦: ..."). This format is dead.',
    '- Generic engagement bait: "What\'s your favorite app on Base?" "Let me know what you think!"',
    `- These phrases: ${SLOP_PHRASES.slice(0, 14).join(', ')}.`,
    '- Ending with a motivational line, a lesson learned, or a call to action.',
    '- Using 🚀 💡 🎯 ✅ 🔥 ⚡ 🏆 💪 emojis. These immediately signal AI output.',
    '- Vague claims that could apply to any blockchain: "low fees and fast transactions."',
    '- Writing about Base like it is a product you are selling to someone.',
    '- Long dashes (— or –). Use "..." if you need a pause.',
    '',
    '=== HARD RULES ===',
    '- Mention "Base" once, naturally. Maximum twice only if it fits.',
    '- Do NOT copy or closely paraphrase any source post.',
    '- Do NOT invent metrics, announcements, partnerships, or insider information.',
    '- Keep emoji use to 0 or 1 max. Only if it genuinely fits.',
    '- Output ONLY the post text. No quotes, no labels, no preamble.',
    '',
    'What you know about Base (stay within this; do not invent facts):',
    ...BASE_FACTS.map((x) => `- ${x}`),
  ].join('\n')

  const user = [
    `[Variety seed: ${seed}]`,
    '',
    `Format: ${style.label}`,
    `Formatting rules: ${style.formatGuide}`,
    `Angle for this post: ${angle}`,
    `Topic area: ${args.topicTag}`,
    '',
    `Do NOT open the post with: ${BANNED_OPENERS.join(', ')}`,
    '',
    args.recentTexts.length
      ? `Recent posts by this user (avoid repeating the same angle or phrasing):\n${args.recentTexts.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
      : '',
    '',
    sourceBlock
      ? `Real posts from the Base community right now (raw signal for what people are thinking — do NOT copy or paraphrase directly):\n${sourceBlock}`
      : '',
    '',
    args.extraPrompt?.trim()
      ? `User context (incorporate if relevant, ignore if it doesn't fit naturally):\n${args.extraPrompt.trim()}`
      : '',
    '',
    'Write the post now. One post only. Make it feel like you actually lived it or thought it — not like you were asked to write about Base.',
  ].filter(Boolean).join('\n')

  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 1.2,
    presence_penalty: 0.9,
    frequency_penalty: 0.5,
    max_tokens: style.maxTokens,
  }

  let resp: Response
  try {
    // 15s timeout — if OpenAI is slower than that, fall back to local
    resp = await openaiChatWithTimeout(body, apiKey, 15000)
  } catch {
    return fastLocalGenerate(args)
  }

  if (!resp.ok) return fastLocalGenerate(args)

  const jsonResp: any = await resp.json().catch(() => null)
  const out = String(jsonResp?.choices?.[0]?.message?.content || '').trim()
  if (!out) return fastLocalGenerate(args)

  let cleaned = clampChars(postProcessOutput(out), style.maxChars)

  // Strip banned openers
  const lower = cleaned.toLowerCase().trim()
  for (const opener of BANNED_OPENERS) {
    if (lower.startsWith(opener.toLowerCase())) {
      const after = cleaned.slice(opener.length).replace(/^[\s:,.-]+/, '')
      if (after.length > 30) cleaned = postProcessOutput(after)
      break
    }
  }

  // Strip checklist format (- [ ] pattern) — collapse to prose
  if (/^[-*]\s*\[[ x]\]/m.test(cleaned)) {
    cleaned = cleaned
      .split('\n')
      .map((l) => l.replace(/^[-*]\s*\[[ x]\]\s*/, '').trim())
      .filter(Boolean)
      .join(' ')
    cleaned = clampChars(postProcessOutput(cleaned), style.maxChars)
  }

  // Strip fake-character dialogue (e.g. "Name🟦: ...")
  if (/\w+[\s\S]{0,4}🟦\s*:/.test(cleaned)) {
    cleaned = cleaned
      .split('\n')
      .map((l) => l.replace(/^\w[\w\s]{0,20}🟦\s*:\s*/, '').trim())
      .filter(Boolean)
      .join('\n')
    cleaned = clampChars(postProcessOutput(cleaned), style.maxChars)
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

    const extraPrompt = String(body?.prompt || '').slice(0, 600)
    const limit = Math.max(1, Math.min(200, Number(body?.limit || 50)))

    const user = await getOrCreateUser(userId)
    if (user.credits < 3) {
      return json(res, 402, { error: 'Not enough credits (need 3)', credits: user.credits })
    }

    let charged = false
    try {
      // Parallel: Apify + Redis recent — both run together, saves ~500ms
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

      // Single OpenAI call, 15s timeout, then fallback to local
      let text = await openaiGenerate({
        posts: chosenSources,
        style: usedStyle,
        topicTag: usedTopicTag,
        recentTexts,
        extraPrompt,
      })

      text = ensureBaseMention(text)

      // Double-check credits & charge
      const latest = await getOrCreateUser(userId)
      if (latest.credits < 3) {
        return json(res, 402, { error: 'Not enough credits (need 3)', credits: latest.credits })
      }

      const after = await adjustCredits(userId, -3)
      charged = true

      // Background tasks — fire and forget, don't block response
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
