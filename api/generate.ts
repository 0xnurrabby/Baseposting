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

  // Strip outer quotes wrapping the entire output
  out = out.replace(/^"([\s\S]*)"$/s, '$1').replace(/^'([\s\S]*)'$/s, '$1').trim()

  // Strip quotes wrapping individual lines (model sometimes wraps each line in quotes)
  out = out.split('\n').map((line) => {
    const t = line.trim()
    if (/^".*"$/.test(t)) return t.slice(1, -1)
    if (/^'.*'$/.test(t)) return t.slice(1, -1)
    return line
  }).join('\n')

  // Replace long dashes
  out = out.replace(/—/g, '...').replace(/–/g, '...').replace(/\u2026/g, '...')
  // Collapse multiple spaces/tabs within a line
  out = out.replace(/[ \t]{2,}/g, ' ')
  // Max 2 consecutive newlines (1 blank line)
  out = out.replace(/\n{3,}/g, '\n\n')

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
    id: 'detailed-take',
    label: 'Detailed personal take with real info',
    formatGuide: [
      'STRUCTURE: hook line → blank line → 3-5 lines of actual substance → blank line → 1 closer.',
      'The hook is ONE punchy line that makes you want to read the next.',
      'The body has REAL information, specific details, actual observations — not vague feelings.',
      'Each body line is short (under 15 words). Separated by blank lines.',
      'NO quotes around lines. NO "let me know". NO lesson summary at the end.',
      'Example:',
      'Base quietly crossed $4B TVL.',
      '',
      'No announcement. No hype campaign.',
      'Just protocols accumulating real liquidity.',
      'Aerodrome alone pulling $1B+ in TVL.',
      'Builders showed up. Liquidity followed.',
      '',
      'That\'s how ecosystems actually grow.',
    ].join('\n'),
    anglePrompts: [
      'a specific metric or development on Base that most people glossed over',
      'why a particular DeFi or social app on Base is gaining traction quietly',
      'what the onchain data actually shows about Base user behavior',
      'a builder trend on Base that signals something real about the ecosystem direction',
      'something that changed on Base recently that most people missed',
    ],
    weight: 1.3,
    maxTokens: 320,
    maxChars: 800,
  },
  {
    id: 'story',
    label: 'Real experience story with context',
    formatGuide: [
      'STRUCTURE: opening scene → blank line → what happened (with specific details) → blank line → reflection.',
      'Tell a real story with actual context. Not just "I did X and it worked."',
      'Include WHY it mattered, WHAT you expected vs what happened, or WHAT it revealed.',
      'Each line is short. Blank line between each thought.',
      'Minimum 6 lines total. The story should feel like something that actually happened.',
      'NO quotes around lines. NO motivational ending.',
      'Example:',
      'Was helping a friend set up her first wallet on Base last week.',
      '',
      'She\'s not technical. Usually gives up with crypto stuff.',
      'Got through bridging, swapping, and a mint in under 20 minutes.',
      'No support ticket. No stuck transaction.',
      '',
      'She asked if this is what crypto was always supposed to feel like.',
      '',
      'I didn\'t have a good answer.',
    ].join('\n'),
    anglePrompts: [
      'the first time you helped someone non-technical use Base successfully',
      'a late-night building session on Base that surprised you',
      'a transaction or interaction that made you realize how much has changed',
      'a moment where Base either failed your expectations or exceeded them',
      'watching someone use a Base app for the first time',
    ],
    weight: 1.2,
    maxTokens: 350,
    maxChars: 900,
  },
  {
    id: 'thread-style',
    label: 'Mini thread — numbered points with context',
    formatGuide: [
      'STRUCTURE: hook line → blank line → 3-4 numbered points, each with a brief explanation.',
      'Each numbered point is 1-2 lines. Blank line between each point.',
      'Points should have ACTUAL INFO — stats, observations, specific app names, real patterns.',
      'Not a list of obvious things. Things a person who actually uses Base would notice.',
      'NO quotes. NO "let me know". Total length should feel substantial.',
      'Example:',
      'Things Base is doing that don\'t get enough attention:',
      '',
      '1. Sub-cent gas on EVM-compatible chain. Not just cheap — actually negligible.',
      '',
      '2. Farcaster frames running natively. Onchain social is already here, just quiet.',
      '',
      '3. Aerodrome TVL growing without token bribes hype. Organic liquidity.',
      '',
      '4. ERC-4337 (account abstraction) actually used in production apps here.',
      '',
      'The ecosystem is building. The noise just hasn\'t caught up.',
    ].join('\n'),
    anglePrompts: [
      'underrated things happening on Base that most of crypto Twitter ignores',
      'specific DeFi protocols on Base worth watching and why',
      'what builders are actually doing on Base right now',
      'the real differences between Base and other L2s from a user perspective',
      'onchain social on Base — what it looks like from the inside',
    ],
    weight: 1.1,
    maxTokens: 380,
    maxChars: 950,
  },
  {
    id: 'contrast',
    label: 'Sharp before vs after with context',
    formatGuide: [
      'STRUCTURE: 2-3 contrast pairs, each with context. Blank line between pairs.',
      'Not just "Used to: X / Now: Y" — add WHY or WHAT CHANGED after each pair.',
      'Be specific. Real details. Not vague.',
      'Example:',
      'Used to mentally calculate gas before every swap.',
      'Now I just execute.',
      '',
      'Used to bridge and wait 7 minutes, refreshing.',
      'Now it lands in seconds. I forget it happened.',
      '',
      'It\'s not that Base is fast. It\'s that it disappeared from my mental overhead.',
      'That\'s what good infra feels like.',
    ].join('\n'),
    anglePrompts: [
      'how deploying on Base changed your workflow vs Ethereum mainnet',
      'checking gas anxiety before Base vs after using Base regularly',
      'what onchain social felt like before Farcaster vs now',
      'your mental model of L2 bridges before vs after Base',
    ],
    weight: 0.85,
    maxTokens: 280,
    maxChars: 700,
  },
  {
    id: 'raw-take',
    label: 'Sharp opinion with supporting reasoning',
    formatGuide: [
      'STRUCTURE: strong opinion as hook → blank line → 3-4 lines explaining the reasoning → blank line → closer.',
      'The opinion must be SPECIFIC, not generic. Back it with actual reasoning.',
      'Each line short. Blank lines between each thought.',
      'Sounds like someone who has actually thought about this — not a hot take for engagement.',
      'Example:',
      'The L2 fee war is mostly noise.',
      '',
      'Fees on every serious L2 are already negligible for retail.',
      'The actual differentiator is ecosystem density.',
      'Which chain has the apps people actually want to use?',
      'Which chain has the liquidity that makes DeFi usable?',
      '',
      'Base won that quietly while everyone was arguing about sequencer revenue.',
    ].join('\n'),
    anglePrompts: [
      'why the L2 debate misses what actually matters',
      'something Base got right that other ecosystems keep getting wrong',
      'why onchain social is more important than most crypto people realize',
      'what the real moat for Base is, and why it isn\'t what most people think',
      'a contrarian take on Base ecosystem growth that is grounded in data',
    ],
    weight: 1.0,
    maxTokens: 320,
    maxChars: 800,
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
    'You are writing one post for Twitter/X that will appear on your personal timeline.',
    '',
    'Your voice: direct, informed, occasionally dry. You have real opinions based on real usage.',
    'You know the ecosystem well — specific protocols, actual metrics, real patterns.',
    '',
    '=== LENGTH REQUIREMENT ===',
    'Posts MUST be substantial. Minimum 6 lines of content. Aim for 8-12 lines.',
    'A 2-line post is a failure. Short empty hooks are NOT acceptable.',
    'Posts should have enough content that someone learns something or feels something real.',
    '',
    '=== TWITTER FORMATTING (CRITICAL) ===',
    'Use short lines with blank lines between thoughts — NOT paragraphs.',
    'Each line: 5-15 words max. Blank line between each thought or sentence.',
    '',
    'CORRECT:',
    'Base crossed $4B TVL last month.',
    '',
    'No big announcement. No campaign.',
    'Just protocols compounding quietly.',
    '',
    'That tells you more than any roadmap post.',
    '',
    'WRONG (never do this):',
    'Base crossed $4B TVL last month with no big announcement or campaign, just protocols compounding quietly, which tells you more than any roadmap post.',
    '',
    '=== CONTENT QUALITY ===',
    '- Include REAL information: specific numbers, protocol names, actual observations.',
    '- Make a point. Share something the reader did not already know or had not thought about.',
    '- Do NOT write vague generic lines like "Base is growing" or "fees are low" without specifics.',
    '- Use the live data and search context provided below when it is relevant.',
    '',
    '=== ABSOLUTE PROHIBITIONS ===',
    '- NO quote marks around individual lines. Write lines directly, no quotes.',
    '- No fake character dialogue (Aneri🟦, Jesse🟦, etc.).',
    '- No checkbox lists "- [ ]".',
    '- No generic engagement bait: "What do you think?" "Let me know below!"',
    `- None of these phrases: ${SLOP_PHRASES.slice(0, 14).join(', ')}.`,
    '- No 🚀 💡 🎯 ✅ 🔥 ⚡ 🏆 💪 emojis. Max 1 emoji total if it genuinely fits.',
    '- No marketing language. Write like a user, not an advertiser.',
    '- Long dashes (— or –) → use "..." instead.',
    '',
    '=== FACTS YOU CAN USE ===',
    ...BASE_STATIC_FACTS.map((f) => `- ${f}`),
    '',
    '=== NEVER CLAIM ===',
    ...BASE_FORBIDDEN_CLAIMS.map((f) => `- ${f}`),
    '',
    args.metricsLine
      ? `=== LIVE BASE DATA (use these if relevant — cite approximately) ===\n- ${args.metricsLine}`
      : '',
    '',
    args.searchContext
      ? `=== CURRENT WEB CONTEXT (verified info from search — use if relevant) ===\n${args.searchContext}`
      : '',
    '',
    '=== OUTPUT ===',
    '- Mention "Base" 1-2 times naturally.',
    '- Do NOT copy source posts.',
    '- Output ONLY the post text. No quotes around it, no labels, no explanation.',
    '- Use real line breaks between lines and blank lines between thoughts.',
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
