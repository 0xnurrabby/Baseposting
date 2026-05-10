export const maxDuration = 30

import crypto from 'node:crypto'
import { adjustCredits, getOrCreateUser, incrementMetric, getRecent, pushRecent } from './_lib/store.js'
import { logCreditSpend } from './_lib/leaderboard.js'
import { handleOptions, json, readJson, requirePost, setCors } from './_lib/http.js'
import { getBaseMetrics, metricsToPromptLine } from './_lib/base-metrics.js'
import { getBaseSearchContext } from './_lib/gemini-search.js'

// ─── Helpers ────────────────────────────────────────────────────────────────

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
  // Strip surrounding quotes if model added them
  out = out.replace(/^"([\s\S]*)"$/s, '$1').replace(/^'([\s\S]*)'$/s, '$1').trim()
  // Replace long dashes with ellipsis
  out = out.replace(/—/g, '...').replace(/–/g, '...').replace(/\u2026/g, '...')
  // Collapse multiple spaces/tabs within a line (but preserve newlines)
  out = out.replace(/[ \t]{2,}/g, ' ')
  // Collapse 3+ consecutive newlines to max 2 (preserve paragraph breaks)
  out = out.replace(/\n{3,}/g, '\n\n')
  // Convert single newlines that are NOT part of a paragraph break into proper separation
  // (keep \n\n as-is, keep single \n as-is — Twitter uses both)
  return out.trim()
}

/**
 * Ensures the post uses proper Twitter line-break formatting.
 * If the output looks like a solid paragraph (no newlines), tries to
 * split it at sentence boundaries to add breathing room.
 */
function enforceTwitterFormat(text: string, maxChars: number): string {
  const trimmed = text.trim()
  if (!trimmed) return trimmed

  // If already has line breaks, it's probably formatted correctly
  if (trimmed.includes('\n')) return clampChars(trimmed, maxChars)

  // It's a single paragraph — split at sentence boundaries
  // Add a blank line between each sentence
  const sentences = trimmed
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)

  if (sentences.length <= 1) return clampChars(trimmed, maxChars)

  return clampChars(sentences.join('\n\n'), maxChars)
}

function ensureBaseMention(text: string): string {
  if (/\bbase\b/i.test(text)) return text
  const suffixes = [
    '\n\nHappened on Base, for context.',
    '\n\nAll of this is on Base.',
    '\n\nBase, specifically.',
    '\n\nContext: Base.',
  ]
  return text.trimEnd() + suffixes[Math.floor(Math.random() * suffixes.length)]
}

// ─── Constants ───────────────────────────────────────────────────────────────

// Ground truth facts the model is allowed to use.
// Never add speculative or exaggerated claims here.
const BASE_STATIC_FACTS = [
  'Base is an Ethereum Layer 2 (L2) built on the OP Stack, incubated by Coinbase.',
  'Base launched to mainnet in August 2023.',
  'Base uses Ethereum for security — it posts transaction data to Ethereum.',
  'Gas fees on Base are literally fractions of a cent for most transactions.',
  'Base is EVM-compatible: Ethereum smart contracts deploy on Base without changes.',
  'Base does not have its own native token.',
  'The Base ecosystem includes DeFi, NFTs, onchain social (Farcaster/Warpcast), and mini apps.',
]

const BASE_FORBIDDEN_CLAIMS = [
  'Do NOT say Base was "just another tech gimmick" — it was not.',
  'Do NOT say Base "had high fees" — it launched with low fees.',
  'Do NOT compare gas fees to coffee, groceries, or other everyday prices.',
  'Do NOT invent specific TVL, DAU, or transaction numbers unless given as live data below.',
  'Do NOT invent partnerships, token launches, or protocol announcements.',
  'Do NOT write about Base like you are selling it.',
]

const SLOP_PHRASES = [
  'unlock', 'game changer', 'revolutionize', 'next level', 'the future is here',
  'join us', "don't sleep on", 'wagmi', 'buidl', 'this is huge',
  'exciting', 'thrilled', 'delighted', 'proud to announce',
  'gem', 'lfg', 'to the moon', 'diamond hands',
  'work wonders', 'nails both', 'secret sauce', 'makes this easy',
  'less than my morning coffee', 'every percentage saved',
]

const BANNED_OPENERS = [
  'gm', 'hot take', 'unpopular opinion', "here's the thing",
  "let's talk about", 'thread', 'just a reminder', 'reminder:',
  'fact:', 'truth:', 'real talk', 'i want to talk about',
  'why do i love', "let me know what you", 'have you ever',
]

// ─── Style deck ───────────────────────────────────────────────────────────────

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
    label: 'Hook + one follow-up line',
    formatGuide: [
      'STRUCTURE: exactly 2 lines separated by a blank line.',
      'Line 1 (hook): short, punchy, stands alone. A specific observation or irony. NOT a question.',
      'Line 2 (landing): the quiet follow-up that reframes or completes it.',
      'Example structure:',
      '  "Sent 12 transactions on Base today."',
      '  ""',
      '  "Thought about gas zero times."',
      'Do NOT run them together into one sentence.',
    ].join('\n'),
    anglePrompts: [
      'something that felt weird until it just worked',
      'a small thing you noticed that others probably missed',
      'the gap between how people talk about L2s and what actually happens when you use one',
      'something you used to overthink that turned out to be nothing',
      'a quiet observation about how your onchain habits have shifted',
    ],
    weight: 1.2,
    maxTokens: 80,
    maxChars: 200,
  },
  {
    id: 'micro-story',
    label: 'Personal micro-story (short lines, blank lines between)',
    formatGuide: [
      'STRUCTURE: 3–5 short sentences, each on its own line, separated by blank lines.',
      'Write like a real person recounting a specific small moment.',
      'NO lesson. NO tutorial. NO "the takeaway is". Ending is understated.',
      'Example structure:',
      '  "Tried deploying a contract on Base last night."',
      '  ""',
      '  "Expected the usual friction."',
      '  ""',
      '  "It was live in 4 minutes."',
      '  ""',
      '  "Went to bed."',
      'Keep each line under 12 words. Use commas and periods naturally.',
    ].join('\n'),
    anglePrompts: [
      'the first time a transaction confirmed so fast you had to double-check',
      'trying something new on Base and it just working without drama',
      'explaining Base to someone and realizing how much simpler it actually is now',
      'something broke, you figured it out, moved on',
      'going down a rabbit hole in the Base ecosystem late at night',
    ],
    weight: 1.1,
    maxTokens: 180,
    maxChars: 400,
  },
  {
    id: 'contrast',
    label: 'Before vs after (line-by-line, blank lines between pairs)',
    formatGuide: [
      'STRUCTURE: 2–3 short pairs, each pair on its own line, separated by blank lines.',
      'Use "Used to: ..." then blank line, then "Now: ..."',
      'Personal experience only. Keep each line under 10 words.',
      'Example structure:',
      '  "Used to: check gas before every transaction."',
      '  ""',
      '  "Now: forget gas exists."',
      '  ""',
      '  "Base did that."',
      'IMPORTANT: Base launched with low fees — do not write a "before" implying L2s had high fees.',
    ].join('\n'),
    anglePrompts: [
      'how you thought about deploying contracts before vs how you think about it now',
      'checking gas before every tx vs not thinking about it anymore',
      'what "onchain social" meant to you before Farcaster vs how it feels now',
      'your mental model of L2s before vs after using Base every day',
    ],
    weight: 0.95,
    maxTokens: 160,
    maxChars: 360,
  },
  {
    id: 'raw-take',
    label: 'Raw honest take (hook + short lines)',
    formatGuide: [
      'STRUCTURE: hook line, then blank line, then 2–3 more short lines each separated by blank lines.',
      'Hook line: the sharpest version of your opinion. Direct. No hedging.',
      'Follow-up lines: expand briefly, still sharp.',
      'Example structure:',
      '  "Most L2 debates are about the wrong thing."',
      '  ""',
      '  "People argue fees vs speed."',
      '  ""',
      '  "The actual question is: does it disappear into the background?"',
      '  ""',
      '  "Base does."',
      'Sounds like something you would say to a friend in crypto. NOT a hot take for engagement.',
    ].join('\n'),
    anglePrompts: [
      'why most L2 debates miss what actually matters for daily use',
      'something the Base ecosystem does quietly well that the broader crypto conversation ignores',
      'a misconception about Base you yourself had before using it',
      'why you stopped caring about a specific crypto discourse topic',
      'what makes Base feel different from the builder side vs the user side',
    ],
    weight: 1.0,
    maxTokens: 180,
    maxChars: 400,
  },
  {
    id: 'curious-question',
    label: 'Genuine question + thinking out loud',
    formatGuide: [
      'STRUCTURE: 1 real question on its own line, then blank line, then 1–2 lines of your thinking.',
      'The question must be something you actually wonder. NOT engagement bait.',
      'Your thinking after it is NOT an answer — just where your head is.',
      'Example structure:',
      '  "Why do some Base apps get immediate traction when others with the same idea stay quiet?"',
      '  ""',
      '  "Not obvious it\'s product quality."',
      '  ""',
      '  "Might be timing and who shows up first."',
      'Do NOT end with "let me know" or "drop a comment". You are thinking out loud.',
    ].join('\n'),
    anglePrompts: [
      'something about how builders choose Base vs other chains',
      'a UX pattern across Base apps that surprised you and you want to understand why',
      'what the actual fee and volume data tells you about how people use Base',
      'why some Base apps get real traction when others with similar ideas stay quiet',
    ],
    weight: 0.8,
    maxTokens: 180,
    maxChars: 400,
  },
]

// ─── Topic tags ───────────────────────────────────────────────────────────────

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

// ─── Apify ────────────────────────────────────────────────────────────────────

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

try {
  apifyPrewarmPromise = fetchApifyPostsInner(60).then((arr) => {
    apifyCache = { ts: Date.now(), items: arr }
    return arr
  }).catch(() => [])
} catch { /* ignore */ }

// ─── Style / topic picking ────────────────────────────────────────────────────

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

// ─── Fallback local generator ─────────────────────────────────────────────────

function fastLocalGenerate(args: { posts: Array<{ author: string; text: string }>; style: StyleDeck }): string {
  const corpus = args.posts.map((p) => p.text).join(' ').toLowerCase()
  const has = (words: string[]) => words.some((w) => corpus.includes(w))

  // All fallbacks use Twitter format: short lines + blank lines between
  const fallbacks = [
    "Been using Base almost daily now.\n\nThe part that changed my workflow isn't what I expected.",
    "Deployed something on Base yesterday.\n\nTen minutes from idea to live.\n\nThat used to mean something different.",
    "The quiet thing about Base:\n\nit stops being a topic of conversation the moment it just works.",
    "Still find it funny that the chain I thought I'd try once\n\nis the one I actually use every day.",
    "You stop thinking about gas at some point.\n\nThat's when it starts feeling like infrastructure.",
    "Something clicked about onchain apps this week\n\nthat I didn't expect to click.",
  ]

  let pick = fallbacks[Math.floor(Math.random() * fallbacks.length)]

  if (has(['fee', 'fees', 'gas'])) {
    pick = "Sent a transaction on Base yesterday.\n\nGas was a fraction of a cent.\n\nDidn't think about it.\n\nThat's kind of the point."
  } else if (has(['ship', 'builder', 'build', 'deploy'])) {
    pick = "Shipped something on Base this week I kept putting off.\n\nExpected it to be annoying.\n\nIt wasn't."
  } else if (has(['farcaster', 'cast', 'social', 'frames'])) {
    pick = "Onchain social still feels weird to explain to people outside it.\n\nFrom inside it, it already feels normal."
  } else if (has(['defi', 'swap', 'liquidity', 'yield'])) {
    pick = "The DeFi on Base is genuinely usable now.\n\nThat's a sentence I didn't think I'd say without caveats."
  }

  return clampChars(pick, args.style.maxChars)
}

// ─── OpenAI post generator ────────────────────────────────────────────────────

async function openaiGenerate(args: {
  posts: Array<{ author: string; text: string }>
  style: StyleDeck
  topicTag: string
  recentTexts: string[]
  extraPrompt: string
  metricsLine: string
  searchContext: string   // from Gemini web search — may be empty
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return fastLocalGenerate(args)

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'
  const style = args.style
  const angle = style.anglePrompts[Math.floor(Math.random() * style.anglePrompts.length)]
  const seed = crypto.randomUUID()

  const sourceBlock = args.posts
    .slice(0, 10)
    .map((p, i) => `${i + 1}. @${p.author}: ${p.text}`)
    .join('\n')

  // ── System prompt ──────────────────────────────────────────────
  const system = [
    'You are a real person deeply embedded in the Base blockchain ecosystem — a builder or active daily user.',
    'You are writing one post for Twitter/X (or Farcaster) that will appear on your personal timeline.',
    '',
    'Your voice: direct, occasionally dry, genuinely curious. Sometimes a little tired of hype.',
    'You have actually used Base. You notice small, specific things. You do not write like a marketer.',
    '',
    '=== TWITTER FORMATTING RULES (CRITICAL) ===',
    'Real crypto Twitter posts are NOT written as paragraphs. They use short lines with blank lines between them.',
    'Each idea gets its own line. A blank line (empty line) separates ideas.',
    'This creates visual breathing room and makes each line land harder.',
    '',
    'CORRECT format (short lines + blank lines):',
    '  "Deployed a contract on Base."',
    '  ""',
    '  "Total time: 6 minutes."',
    '  ""',
    '  "I was honestly waiting for something to break."',
    '',
    'WRONG format (paragraph — never do this):',
    '  "I deployed a contract on Base and it only took 6 minutes, which surprised me because I was waiting for something to go wrong."',
    '',
    'Key rules for formatting:',
    '- Keep each line SHORT: 5–14 words maximum per line.',
    '- Put a BLANK LINE between every sentence or thought.',
    '- Never run two ideas together into one long sentence.',
    '- Use commas and periods naturally, but break to a new line often.',
    '- The hook (first line) must be able to stand completely alone.',
    '',
    '=== WHAT MAKES A POST FEEL REAL ===',
    '- It comes from a specific observation or moment, not a general statement.',
    '- It does not try to teach anyone. It says what you noticed or thought.',
    '- It sounds like something you would say in a group chat, not a newsletter.',
    '- It does not wrap up with a lesson, summary, or call to action.',
    '',
    '=== ABSOLUTE PROHIBITIONS ===',
    '- No fake character dialogue: "Aneri🟦: ..." "Jesse🟦: ..." — never do this.',
    '- No checkbox lists: "- [ ] Do this" — nobody posts this on Twitter.',
    '- No generic engagement bait: "What do you think?" "Let me know below!"',
    '- No self-promotional openers: "Why do I love Base?" "Base is amazing because..."',
    `- None of these phrases: ${SLOP_PHRASES.slice(0, 14).join(', ')}.`,
    '- No 🚀 💡 🎯 ✅ 🔥 ⚡ 🏆 💪 emojis. Max 1 emoji total, only if it genuinely fits.',
    '- No writing about Base like you are advertising a product.',
    '- Long dashes (— or –) → use "..." instead.',
    '- NO paragraphs. If a thought is longer than 14 words, break it into two lines.',
    '',
    '=== FACTS YOU ARE ALLOWED TO USE ===',
    ...BASE_STATIC_FACTS.map((f) => `- ${f}`),
    '',
    '=== WHAT YOU MUST NEVER CLAIM ===',
    ...BASE_FORBIDDEN_CLAIMS.map((f) => `- ${f}`),
    '',
    args.metricsLine
      ? `=== LIVE BASE ONCHAIN DATA (use these numbers approximately if relevant) ===\n- ${args.metricsLine}`
      : '',
    '',
    args.searchContext
      ? `=== CURRENT NEWS / CONTEXT FROM WEB SEARCH (verified, use if genuinely relevant) ===\n${args.searchContext}`
      : '',
    '',
    '=== OUTPUT RULES ===',
    '- Mention "Base" at most twice. Once is usually enough.',
    '- Do NOT copy or closely paraphrase source posts.',
    '- Output ONLY the post text. No quotes, no preamble, no explanation.',
    '- Use actual newlines (\\n) between lines and double newlines (\\n\\n) for blank lines between thoughts.',
  ].filter(Boolean).join('\n')

  // ── User prompt ────────────────────────────────────────────────
  const user = [
    `[Variety seed: ${seed}]`,
    '',
    `Format: ${style.label}`,
    `Formatting rules: ${style.formatGuide}`,
    `Angle for this post: ${angle}`,
    `Topic area: ${args.topicTag}`,
    '',
    `Do NOT open with any of: ${BANNED_OPENERS.join(', ')}`,
    '',
    args.recentTexts.length
      ? `This user recently posted these — avoid the same angle or phrasing:\n${args.recentTexts.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
      : '',
    '',
    sourceBlock
      ? `Real posts from the Base community right now (raw inspiration — do NOT copy or paraphrase):\n${sourceBlock}`
      : '',
    '',
    args.extraPrompt?.trim()
      ? `User context (use naturally if it fits, otherwise ignore):\n${args.extraPrompt.trim()}`
      : '',
    '',
    'Write the post now. One post only. Make it feel like you actually lived it or thought it — not like you were assigned to write about Base.',
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
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), 15000)
    try {
      resp = await fetch('https://api.openai.com/v1/chat/completions', {
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
  } catch {
    return fastLocalGenerate(args)
  }

  if (!resp.ok) return fastLocalGenerate(args)

  const jsonResp: any = await resp.json().catch(() => null)
  const out = String(jsonResp?.choices?.[0]?.message?.content || '').trim()
  if (!out) return fastLocalGenerate(args)

  let cleaned = postProcessOutput(out)

  // Strip banned openers
  const lower = cleaned.toLowerCase().trim()
  for (const opener of BANNED_OPENERS) {
    if (lower.startsWith(opener.toLowerCase())) {
      const after = cleaned.slice(opener.length).replace(/^[\s:,.-]+/, '')
      if (after.length > 30) cleaned = postProcessOutput(after)
      break
    }
  }

  // Strip checklist format (- [ ] pattern) → flatten to Twitter lines
  if (/^[-*]\s*\[[ x]\]/m.test(cleaned)) {
    cleaned = cleaned
      .split('\n')
      .map((l) => l.replace(/^[-*]\s*\[[ x]\]\s*/, '').trim())
      .filter(Boolean)
      .join('\n\n')
    cleaned = postProcessOutput(cleaned)
  }

  // Strip fake character dialogue (e.g. "Aneri🟦: ...")
  if (/\w[\w\s]{0,15}🟦\s*:/.test(cleaned)) {
    cleaned = cleaned
      .split('\n')
      .map((l) => l.replace(/^\w[\w\s]{0,20}🟦\s*:\s*/, '').trim())
      .filter(Boolean)
      .join('\n\n')
    cleaned = postProcessOutput(cleaned)
  }

  // Enforce Twitter line-break format (no solid paragraphs)
  cleaned = enforceTwitterFormat(cleaned, style.maxChars)

  return cleaned
}

// ─── Handler ──────────────────────────────────────────────────────────────────

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
      // Step 1: Fetch all data sources in parallel
      // Apify (Twitter scrape) + Redis recent + DeFiLlama metrics
      const [apifyItems, recent, metrics] = await Promise.all([
        fetchApifyPosts(limit),
        getRecent(userId, 'post', 12).catch(() => []),
        getBaseMetrics().catch(() => null),
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
        10
      )

      const metricsLine = metrics ? metricsToPromptLine(metrics) : ''

      // Step 2: Gemini web search — runs concurrently, does not block if fails
      // ~30% of the time we skip search to save credits and add variety
      const shouldSearch = Math.random() > 0.3
      const searchCtx = shouldSearch
        ? await getBaseSearchContext(usedTopicTag).catch(() => ({ summary: '', skipped: true }))
        : { summary: '', skipped: true }

      const searchContext = (!searchCtx.skipped && searchCtx.summary) ? searchCtx.summary : ''

      // Step 3: OpenAI generates the final post using all context
      let text = await openaiGenerate({
        posts: chosenSources,
        style: usedStyle,
        topicTag: usedTopicTag,
        recentTexts,
        extraPrompt,
        metricsLine,
        searchContext,
      })

      text = ensureBaseMention(text)

      // Step 4: Charge credits
      const latest = await getOrCreateUser(userId)
      if (latest.credits < 3) {
        return json(res, 402, { error: 'Not enough credits (need 3)', credits: latest.credits })
      }

      const after = await adjustCredits(userId, -3)
      charged = true

      // Step 5: Background tasks — fire and forget
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
        searchUsed: !!searchContext,
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
