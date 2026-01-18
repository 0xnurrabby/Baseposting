import crypto from 'node:crypto'
import { adjustCredits, getOrCreateUser, incrementMetric, getRedisClient } from './_lib/store.js'
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

type NormalizedPost = {
  author: string
  text: string
  createdAt: any
  likeCount: number | null
  replyCount: number | null
  repostCount: number | null
  category?: string
}

function normalizePosts(items: any[], max: number): NormalizedPost[] {
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
      } as NormalizedPost
    })
    .filter(Boolean) as NormalizedPost[]

  // Prefer non-empty unique texts
  const seen = new Set<string>()
  const out: NormalizedPost[] = []
  for (const p of normalized) {
    const key = p.text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
    if (out.length >= max) break
  }
  return out
}

// --- Variety controls (topic + formatting) ---

type FormatTemplate = {
  key: string
  name: string
  desc: string
  hardRules: string[]
  targetChars: string
  // Higher = more likely. Default is 1.
  weight?: number
}

const FORMAT_TEMPLATES: FormatTemplate[] = [
  {
    key: 'two_lines',
    name: 'Two lines',
    desc: 'Two short lines, no blank line between them.',
    hardRules: ['Exactly 2 lines.', 'No blank line between lines.'],
    targetChars: '≤ 220 chars',
    weight: 1.15,
  },
  {
    key: 'spaced_punchline',
    name: 'Spaced punchline',
    desc: 'One line, then a blank line, then a second line (classic Farcaster spacing).',
    hardRules: ['Exactly 3 lines total.', 'Line 2 must be blank.', 'Line 1 and line 3 must be non-empty.', 'No bullets.'],
    targetChars: '≤ 260 chars',
    weight: 1.55,
  },
  {
    key: 'stanza',
    name: 'Stanza',
    desc: '3–5 short lines. May include 1 blank line, but not required.',
    hardRules: ['3 to 5 lines total.', 'At most ONE blank line.'],
    targetChars: '≤ 320 chars',
    weight: 1.2,
  },
  {
    key: 'mini_list_dash',
    name: 'Mini list (dash)',
    desc: 'A tiny list: intro line, optional blank line, then 2–4 dash bullets.',
    hardRules: ['Intro line first.', 'Then 2 to 4 bullets.', 'Each bullet must start with "- ".', 'No other bullet symbols.'],
    targetChars: '≤ 420 chars',
    weight: 1.55,
  },
  {
    key: 'mini_list_dot',
    name: 'Mini list (dot)',
    desc: 'A tiny list: intro line, optional blank line, then 2–4 dot bullets.',
    hardRules: ['Intro line first.', 'Then 2 to 4 bullets.', 'Each bullet must start with "• ".', 'No other bullet symbols.'],
    targetChars: '≤ 420 chars',
    weight: 1.35,
  },
  {
    key: 'q_and_a',
    name: 'Q&A',
    desc: 'A question line, then a short answer line.',
    hardRules: ['Line 1 must be a question ending with "?"', 'Line 2 answers it.', 'Exactly 2 lines.'],
    targetChars: '≤ 240 chars',
    weight: 1.2,
  },
  {
    key: 'tldr_quotes',
    name: 'TL;DR quotes',
    desc: 'Short setup, blank line, then a TL;DR block with > quoted lines.',
    hardRules: [
      'Include a setup line first.',
      'Then a blank line.',
      'Then a line that starts with "TL;DR".',
      'Then 2 to 4 lines that each start with "> ".',
    ],
    targetChars: '≤ 520 chars',
    weight: 1.25,
  },
  {
    key: 'timeline_arrows',
    name: 'Timeline arrows',
    desc: 'A short title line, blank line, then 3–5 lines that start with →',
    hardRules: ['Line 1 is a title.', 'Line 2 is blank.', 'Then 3 to 5 lines starting with "→ ".'],
    targetChars: '≤ 520 chars',
    weight: 1.25,
  },
]

const STYLE_SEEDS = [
  'dry humor',
  'builder brain (practical)',
  'contrarian but friendly',
  'high-signal, low-noise',
  'light meme energy (not cringe)',
  'curious question',
  'sharp analogy',
  'tiny story / observation',
]

const BANNED_OPENERS = [
  'gm',
  'hot take',
  'unpopular opinion',
  "here's the thing",
  "let's talk about",
  'thread',
]

const BANNED_SLOP_PHRASES = [
  'launchpad',
  'momentum',
  'building something epic',
  'the future',
  'next level',
  'game changer',
  'thrive',
  'shake things up',
  'brick in the wall',
]

const BASE_GUARDRAILS = [
  'Do not invent announcements, partnerships, token launches, metrics, or schedules.',
  'If you cannot verify a claim from the provided source posts + user context, keep it general.',
  'Do not copy or closely paraphrase any single source post.',
]

const FALLBACK_CATEGORIES = [
  'builder_tip',
  'trading_mood',
  'onchain_social',
  'community_observation',
  'funny_one_liner',
  'question_prompt',
  'mini_update',
]

// Category weights (lower = less likely). User feedback: giveaway posts often feel low-quality.
// Keep giveaways rare, and when chosen, generate them as a *PSA/observation* (not “rules: join group”).
const CATEGORY_WEIGHTS: Record<string, number> = {
  giveaway: 0.22,
  gm: 0.4,
  micro_story: 1.05,
  builder_tip: 1.15,
  onchain_social: 1.1,
  trading_mood: 1.0,
  mini_update: 1.0,
  funny_one_liner: 1.0,
  question_prompt: 1.0,
  community_observation: 1.0,
}

function categorizeText(text: string): string {
  const t = String(text || '').toLowerCase()
  const hasQ = t.includes('?')

  if (/(\bgm\b|good morning)/.test(t)) return 'gm'
  if (/(giveaway|airdrop|rules:|ends in|join group|join channel|usd\b)/.test(t)) return 'giveaway'
  if (/(bullish|bearish|price|chart|token|mcap|market|perp|perps|alpha|bag|pump|dump)/.test(t)) return 'trading_mood'
  if (/(build|builder|ship|shipping|dev|deploy|contract|bounty|quest|hackathon|sdk)/.test(t)) return 'builder_tip'
  if (/(warpcast|farcaster|cast|frame|mini app|channel)/.test(t)) return 'onchain_social'
  if (/(lol|lmao|meme|funny|😂|🤣)/.test(t)) return 'funny_one_liner'
  if (hasQ) return 'question_prompt'
  if (/(today|this week|last 7 days|recap|update|released|episode|season)/.test(t)) return 'mini_update'
  if (/(most people|the people who|if you can|before|my .* told me|i used to|i just)/.test(t)) return 'micro_story'

  return 'community_observation'
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function pickWithHistory<T extends { key?: string }>(pool: T[], recentKeys: string[], getKey: (t: T) => string): T {
  const recent = new Set(recentKeys.filter(Boolean))
  const candidates = pool.filter((x) => !recent.has(getKey(x)))
  const chooseFrom = candidates.length ? candidates : pool
  return chooseFrom[Math.floor(Math.random() * chooseFrom.length)]
}

function weightedPickFormat(formats: FormatTemplate[], recent: string[]): FormatTemplate {
  const recentSet = new Set(recent.filter(Boolean))
  const pool = formats.filter((f) => !recentSet.has(f.key))
  const chooseFrom = pool.length ? pool : formats

  let total = 0
  const weights = chooseFrom.map((f) => {
    const w = Math.max(0.05, Number(f.weight ?? 1))
    total += w
    return w
  })

  let r = Math.random() * total
  for (let i = 0; i < chooseFrom.length; i++) {
    r -= weights[i]
    if (r <= 0) return chooseFrom[i]
  }
  return chooseFrom[chooseFrom.length - 1] || formats[0]
}

function weightedPickCategory(categoryPool: string[], recentCats: string[]): string {
  const recent = new Set(recentCats.filter(Boolean))
  const pool = categoryPool.filter((c) => c && !recent.has(c))
  const chooseFrom = pool.length ? pool : categoryPool

  // If we have enough alternatives, avoid giveaways aggressively.
  const nonGiveaway = chooseFrom.filter((c) => c !== 'giveaway')
  const finalPool = nonGiveaway.length >= 3 ? nonGiveaway : chooseFrom

  let total = 0
  const weights = finalPool.map((c) => {
    const w = Math.max(0.05, Number(CATEGORY_WEIGHTS[c] ?? 1))
    total += w
    return w
  })

  let r = Math.random() * total
  for (let i = 0; i < finalPool.length; i++) {
    r -= weights[i]
    if (r <= 0) return finalPool[i]
  }
  return finalPool[finalPool.length - 1] || 'community_observation'
}

const BASE_CONTEXT_RE = /(\bbase\b|on\s+base|base\s+(chain|ecosystem|builders|community|timeline|culture)|@base\b)/i
const CONTENT_HOOK_RE = /(build|builder|ship|shipping|deploy|dev|frame|cast|warpcast|farcaster|wallet|swap|bridge|contract|bounty|quest|trade|perp|fees?|tx|gas|eth|ethereum|coinbase)/i

function validatePostClarity(text: string, category: string): string | null {
  const t = String(text || '').trim()
  if (!t) return 'Empty output'

  // Must contain an explicit Base anchor so the reader knows the context.
  if (!BASE_CONTEXT_RE.test(t)) return 'Missing Base anchor'

  // Avoid vague "someone said" without grounding it in Base context.
  if (/(someone|somebody|they|them|this space|the community)/i.test(t) && !BASE_CONTEXT_RE.test(t)) return 'Too vague / missing context'

  // For longer posts, require at least one concrete hook to avoid empty/vibe-only output.
  if (t.length >= 80 && !CONTENT_HOOK_RE.test(t)) return 'Missing concrete hook'

  // If this is a giveaway category, force it to be a *PSA* style (avoid inventing money / rules).
  if (category === 'giveaway') {
    const bad = /(rules:|join group|join channel|ends in|like\s*&\s*rt|retweet|tag\b|dm\s+me)/i
    if (bad.test(t)) return 'Giveaway output looks like spam rules'
    const needsPsa = /(verify|double[- ]check|official|scam|phish|careful|beware)/i
    if (!needsPsa.test(t)) return 'Giveaway output missing PSA angle'
  }

  return null
}

function validateFormatCompliance(text: string, format: FormatTemplate): string | null {
  const raw = String(text || '')
  if (!raw.trim()) return 'Empty output'
  const lines = raw.split('\n')
  const nonEmpty = lines.filter((l) => l.trim().length > 0)

  const countBlank = () => lines.filter((l) => l.trim() === '').length

  switch (format.key) {
    case 'two_lines': {
      if (lines.length !== 2) return 'Expected exactly 2 lines'
      if (lines.some((l) => l.trim() === '')) return 'Two-line format cannot include blank lines'
      return null
    }
    case 'spaced_punchline': {
      if (lines.length !== 3) return 'Expected exactly 3 lines (with a blank middle line)'
      if (lines[0].trim() === '' || lines[2].trim() === '') return 'First and last line must be non-empty'
      if (lines[1].trim() !== '') return 'Middle line must be blank'
      if (nonEmpty.some((l) => l.startsWith('- ') || l.startsWith('• ') || l.startsWith('> ') || l.startsWith('→ '))) {
        return 'Spaced punchline cannot use bullets/quotes/arrows'
      }
      return null
    }
    case 'stanza': {
      if (lines.length < 3 || lines.length > 5) return 'Stanza must be 3–5 lines'
      if (countBlank() > 1) return 'Stanza can have at most one blank line'
      return null
    }
    case 'mini_list_dash': {
      if (lines.length < 3) return 'Mini list needs at least an intro + 2 bullets'
      const intro = lines[0]
      if (!intro || !intro.trim()) return 'Mini list must start with an intro line'
      // Allow optional blank line after intro
      const rest = lines.slice(1).filter((l) => l !== '')
      const bullets = rest.filter((l) => l.trim().startsWith('- '))
      if (bullets.length < 2 || bullets.length > 4) return 'Mini list must have 2–4 dash bullets'
      if (rest.length !== bullets.length) return 'All lines after the intro must be dash bullets (no extra paragraphs)'
      if (!bullets.every((l) => l.startsWith('- '))) return 'Bullets must start with "- "'
      return null
    }
    case 'mini_list_dot': {
      if (lines.length < 3) return 'Mini list needs at least an intro + 2 bullets'
      const intro = lines[0]
      if (!intro || !intro.trim()) return 'Mini list must start with an intro line'
      const rest = lines.slice(1).filter((l) => l !== '')
      const bullets = rest.filter((l) => l.trim().startsWith('• '))
      if (bullets.length < 2 || bullets.length > 4) return 'Mini list must have 2–4 dot bullets'
      if (rest.length !== bullets.length) return 'All lines after the intro must be dot bullets (no extra paragraphs)'
      if (!bullets.every((l) => l.startsWith('• '))) return 'Bullets must start with "• "'
      return null
    }
    case 'q_and_a': {
      if (lines.length !== 2) return 'Q&A must be exactly 2 lines'
      if (!lines[0].trim().endsWith('?')) return 'Q&A first line must end with "?"'
      if (!lines[1].trim()) return 'Q&A second line must be non-empty'
      return null
    }
    case 'tldr_quotes': {
      if (lines.length < 5) return 'TL;DR quotes needs setup + blank + TL;DR + 2–4 quoted lines'
      if (!lines[0].trim()) return 'TL;DR quotes must start with a setup line'
      if (lines[1].trim() !== '') return 'TL;DR quotes line 2 must be blank'
      if (!lines[2].trim().toLowerCase().startsWith('tl;dr')) return 'TL;DR line must start with "TL;DR"'
      const quoteLines = lines.slice(3).filter((l) => l.trim().length > 0)
      if (quoteLines.length < 2 || quoteLines.length > 4) return 'Need 2–4 quoted lines'
      if (!quoteLines.every((l) => l.startsWith('> '))) return 'Each quoted line must start with "> "'
      return null
    }
    case 'timeline_arrows': {
      if (lines.length < 5) return 'Timeline needs title + blank + 3–5 arrow lines'
      if (!lines[0].trim()) return 'Timeline must start with a title line'
      if (lines[1].trim() !== '') return 'Timeline line 2 must be blank'
      const arrowLines = lines.slice(2).filter((l) => l.trim().length > 0)
      if (arrowLines.length < 3 || arrowLines.length > 5) return 'Timeline must have 3–5 arrow lines'
      if (!arrowLines.every((l) => l.startsWith('→ '))) return 'Each timeline line must start with "→ "'
      return null
    }
    default: {
      // If we add new templates later, keep a conservative guard: require at least one newline.
      if (!raw.includes('\n')) return 'Expected multi-line output'
      return null
    }
  }
}

function tokenize(s: string): string[] {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 500)
}

function jaccard(a: string, b: string): number {
  const A = new Set(tokenize(a))
  const B = new Set(tokenize(b))
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const w of A) if (B.has(w)) inter++
  const union = A.size + B.size - inter
  return union ? inter / union : 0
}

function isTooSimilar(candidate: string, history: Array<{ text: string }>): boolean {
  for (const h of history.slice(0, 6)) {
    const sim = jaccard(candidate, h.text)
    if (sim >= 0.55) return true
    // Hard guard: exact prefix / repeated first 40 chars
    const a = candidate.trim().slice(0, 40).toLowerCase()
    const b = h.text.trim().slice(0, 40).toLowerCase()
    if (a && b && a === b) return true
  }
  return false
}

function postProcessOutput(text: string) {
  let out = String(text || '').trim()
  if (!out) return out

  // Enforce: no em/en dashes. Use ellipsis instead.
  out = out.replace(/[\u2014\u2013]/g, '...')
  // Normalize unicode ellipsis to three dots so it feels more "human typed".
  out = out.replace(/\u2026/g, '...')

  // Trim trailing spaces per line + collapse excessive blank lines (keep max 1 blank line).
  out = out
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{4,}/g, '\n\n')
    .trim()

  return out
}

async function fetchApifyPosts(limit: number) {
  const datasetId = process.env.APIFY_DATASET_ID
  const token = process.env.APIFY_TOKEN
  if (!datasetId || !token) {
    throw new Error('Server missing APIFY_DATASET_ID or APIFY_TOKEN')
  }

  const url = `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&limit=${encodeURIComponent(String(limit))}&token=${encodeURIComponent(token)}`
  const r = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!r.ok) throw new Error(`Apify error: ${r.status}`)
  const items = await r.json()
  return Array.isArray(items) ? items : []
}

type GenHistoryItem = {
  text: string
  category: string
  format: string
  style: string
  ts: number
}

const memoryHistory = new Map<string, GenHistoryItem[]>()
const HISTORY_KEY_PREFIX = 'genhist:'

async function loadHistory(userId: string): Promise<GenHistoryItem[]> {
  const redis = getRedisClient()
  if (!redis) return memoryHistory.get(userId) || []
  try {
    const raw = await redis.get<string>(HISTORY_KEY_PREFIX + userId)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((x) => x && typeof x.text === 'string')
      .slice(0, 12)
      .map((x) => ({
        text: String(x.text),
        category: String(x.category || ''),
        format: String(x.format || ''),
        style: String(x.style || ''),
        ts: Number(x.ts || 0),
      }))
  } catch {
    return []
  }
}

async function saveHistory(userId: string, items: GenHistoryItem[]) {
  const trimmed = items.slice(0, 12)
  const redis = getRedisClient()
  if (!redis) {
    memoryHistory.set(userId, trimmed)
    return
  }
  try {
    await redis.set(HISTORY_KEY_PREFIX + userId, JSON.stringify(trimmed))
    // Keep around for 30 days (best-effort). Not all envs support expire; ignore failures.
    try {
      await redis.expire(HISTORY_KEY_PREFIX + userId, 60 * 60 * 24 * 30)
    } catch {
      // ignore
    }
  } catch {
    // ignore
  }
}

async function appendHistory(userId: string, item: GenHistoryItem) {
  const prev = await loadHistory(userId)
  const next = [item, ...prev].slice(0, 12)
  await saveHistory(userId, next)
}

function buildInspirationBlock(posts: NormalizedPost[], category: string) {
  const filtered = posts.filter((p) => (p.category || '') === category)
  const ranked = filtered
    .slice()
    .sort((a, b) => (Number(b.likeCount || 0) + Number(b.repostCount || 0)) - (Number(a.likeCount || 0) + Number(a.repostCount || 0)))

  const pick = (arr: NormalizedPost[], n: number) => {
    const out: NormalizedPost[] = []
    const seen = new Set<string>()
    for (const p of arr) {
      const k = p.text.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      out.push(p)
      if (out.length >= n) break
    }
    return out
  }

  const top = pick(ranked, 4)
  const restPool = shuffle(filtered).slice(0, 8)
  const rest = pick(restPool, 6).filter((p) => !top.some((t) => t.text === p.text))

  const chosen = [...top, ...rest].slice(0, 8)
  const lines = chosen.map((p, i) => `${i + 1}. @${p.author}: ${p.text}`)
  return lines.join('\n')
}

async function openaiGenerate(args: {
  userId: string
  extraPrompt: string
  posts: NormalizedPost[]
  category: string
  format: FormatTemplate
  style: string
  attempt: number
}) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('Server missing OPENAI_API_KEY')

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

  const seed = crypto.randomUUID()
  const inspiration = buildInspirationBlock(args.posts, args.category)

  const system = [
    'You write posts for Farcaster/Base culture that feel 100% human.',
    'Goal: craft ONE post that is varied, specific, and not template-y.',
    'The post must be self-contained: a reader should understand the Base/Farcaster context without extra explanation.',
    '',
    'Hard rules:',
    '- Output ONLY the final post text (no quotes, no prefaces).',
    '- Follow the requested format template EXACTLY, including line breaks and required prefixes ("- ", "• ", "> ", "→ ").',
    '- Never put the post in a code block (no ``` fences).',
    '- Do NOT copy or closely paraphrase any single source post.',
    '- Avoid AI-sounding phrases, corporate tone, or generic hype.',
    '- Include at least one explicit Base anchor (e.g., "Base", "on Base", "Base builders", "Base ecosystem", "@base").',
    '- If you refer to "the community" or "people", ground it: say "Base community" / "builders on Base" etc.',
    '- No hashtags unless it feels genuinely organic (max 1).',
    '- Emojis are optional; if used, max 1 and not “aesthetic” ones.',
    '- Do NOT use long dashes (—) or en dashes (–). Use "..." if needed.',
    '',
    'Avoid these openers:',
    `- ${BANNED_OPENERS.join(', ')}`,
    '',
    'Avoid these overused phrases:',
    `- ${BANNED_SLOP_PHRASES.join(', ')}`,
    '',
    'Safety / truth:',
    ...BASE_GUARDRAILS.map((x) => `- ${x}`),
    '',
    'Clarity rules:',
    '- Include at least ONE explicit Base anchor word: "Base" or "on Base" or "Base builders" (so the context is clear).',
    '- If you mention "community" / "timeline" / "this space", ground it as "Base community" / "Base timeline" etc.',
    '- Avoid vague references like "someone said" unless you specify "someone on Base" or "a builder in the Base community".',
    '',
    'Important: Do NOT always explain what Base is. Base can be background/culture.',
    'You can write about builders, onchain social, trading mood, community humor, or tiny observations, as long as it still fits “Base world”.',
  ].join('\n')

  const formatRules = [
    `Format template: ${args.format.name} — ${args.format.desc}`,
    `Target length: ${args.format.targetChars}`,
    'Template hard rules:',
    ...args.format.hardRules.map((r) => `- ${r}`),
  ].join('\n')

  const categoryNote =
    args.category === 'giveaway'
      ? [
          'Category note (giveaway): Write as a PSA/observation on Base, not a promotion.',
          '- Do NOT invent money amounts, winners, deadlines, or rules.',
          '- Do NOT say "Like & RT", "join group", "DM me", etc.',
          '- Do mention verifying official sources / scam awareness in 1 line.',
        ].join('\n')
      : ''

  const user = [
    `Variety seed: ${seed}`,
    `Style seed: ${args.style}`,
    `Topic category: ${args.category}`,
    `Attempt: ${args.attempt}`,
    '',
    formatRules,
    '',
    'Source posts (inspiration only; do NOT copy):',
    inspiration || '(none)',
    '',
    'User extra context (if any):',
    args.extraPrompt?.trim() ? args.extraPrompt.trim() : '(none)',
    '',
    categoryNote,
    '',
    'Write 1 post now.',
  ].join('\n')

  const body: any = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 1.1,
    top_p: 0.92,
    presence_penalty: 0.8,
    frequency_penalty: 0.35,
    max_tokens: 220,
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

  const cleaned = postProcessOutput(out)

  // Soft enforcement: avoid banned openers
  const lower = cleaned.toLowerCase().trim()
  for (const opener of BANNED_OPENERS) {
    if (lower === opener || lower.startsWith(opener + ' ')) {
      return postProcessOutput(`Noticed something... ${cleaned}`)
    }
  }

  return cleaned
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

  const extraPrompt = String(body?.prompt || '').slice(0, 800)
  const limit = Math.max(20, Math.min(250, Number(body?.limit || 120)))

  const user = await getOrCreateUser(userId)
  if (user.credits < 1) {
    return json(res, 402, { error: 'Not enough credits', credits: user.credits })
  }

  // Charge 1 credit up-front; refund on failure.
  await adjustCredits(userId, -1)

  try {
    // Pull a larger pool so we actually get topic variety.
    const apifyItems = await fetchApifyPosts(limit)
    const posts = normalizePosts(apifyItems, 120)

    // Categorize posts for topic selection.
    for (const p of posts) p.category = categorizeText(p.text)

    const history = await loadHistory(userId)
    const recentCats = history.map((h) => h.category).filter(Boolean).slice(0, 2)
    const recentFormats = history.map((h) => h.format).filter(Boolean).slice(0, 2)

    const categories = Array.from(new Set(posts.map((p) => p.category).filter(Boolean)))
    const categoryPool = categories.length ? categories : FALLBACK_CATEGORIES

    // Pick a category + format that avoids immediate repetition.
    const category = weightedPickCategory(categoryPool, recentCats)

    const format = weightedPickFormat(FORMAT_TEMPLATES, recentFormats)
    const style = STYLE_SEEDS[Math.floor(Math.random() * STYLE_SEEDS.length)]

    let text = ''

    // Try a few times until we get something not-too-similar.
    const maxAttempts = 4
    let lastErr: any = null
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const catForAttempt = attempt === 1 ? category : weightedPickCategory(categoryPool, [category, ...recentCats])

      const fmtForAttempt = attempt === 1 ? format : weightedPickFormat(
        FORMAT_TEMPLATES,
        [format.key, ...recentFormats]
      )

      const styleForAttempt = attempt === 1 ? style : STYLE_SEEDS[Math.floor(Math.random() * STYLE_SEEDS.length)]

      try {
        const out = await openaiGenerate({
          userId,
          extraPrompt,
          posts,
          category: catForAttempt,
          format: fmtForAttempt,
          style: styleForAttempt,
          attempt,
        })

        const clarityErr = validatePostClarity(out, catForAttempt)
        if (clarityErr) {
          lastErr = new Error(`Low-quality output: ${clarityErr}`)
          continue
        }

        const formatErr = validateFormatCompliance(out, fmtForAttempt)
        if (formatErr) {
          lastErr = new Error(`Format mismatch: ${formatErr}`)
          continue
        }

        if (out && !isTooSimilar(out, history)) {
          text = out
          // Save history with the actual attempt meta.
          await appendHistory(userId, {
            text,
            category: catForAttempt,
            format: fmtForAttempt.key,
            style: styleForAttempt,
            ts: Date.now(),
          })
          break
        }

        lastErr = new Error('Output too similar to recent generations')
      } catch (e: any) {
        lastErr = e
      }
    }

    if (!text) throw lastErr || new Error('Generation failed')

    // Count successful post generations for admin stats.
    await incrementMetric(userId, 'postCount', 1, 2)
    // Leaderboard metric: credits spent + post count (7d/prev calculations are cron-based).
    await logCreditSpend({ userId, creditsSpent: 1, postDelta: 1 })

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
