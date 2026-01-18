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
}

const FORMAT_TEMPLATES: FormatTemplate[] = [
  {
    key: 'one_liner',
    name: 'One-liner',
    desc: 'One punchy sentence. No line breaks.',
    hardRules: ['Exactly 1 line.', 'No blank lines.', 'No bullets.'],
    targetChars: '≤ 160 chars',
  },
  {
    key: 'two_lines',
    name: 'Two lines',
    desc: 'Two short lines, no blank line between them.',
    hardRules: ['Exactly 2 lines.', 'No blank line between lines.'],
    targetChars: '≤ 220 chars',
  },
  {
    key: 'stanza',
    name: 'Stanza',
    desc: '3–5 short lines. May include 1 blank line, but not required.',
    hardRules: ['3 to 5 lines total.', 'At most ONE blank line.'],
    targetChars: '≤ 320 chars',
  },
  {
    key: 'mini_list',
    name: 'Mini list',
    desc: 'A tiny bullet list (2–3 bullets) with a short intro line.',
    hardRules: ['Intro line + 2 or 3 bullets.', 'Use "-" bullets only.'],
    targetChars: '≤ 360 chars',
  },
  {
    key: 'q_and_a',
    name: 'Q&A',
    desc: 'A question line, then a short answer line.',
    hardRules: ['Line 1 must be a question ending with "?"', 'Line 2 answers it.', 'Exactly 2 lines.'],
    targetChars: '≤ 240 chars',
  },
  {
    key: 'micro_story',
    name: 'Micro story',
    desc: 'Tiny story in 2–3 sentences, single paragraph (no line breaks).',
    hardRules: ['Exactly 1 paragraph (no line breaks).', '2 to 3 sentences.'],
    targetChars: '≤ 320 chars',
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
    '',
    'Hard rules:',
    '- Output ONLY the final post text (no quotes, no prefaces).',
    '- Do NOT copy or closely paraphrase any single source post.',
    '- Avoid AI-sounding phrases, corporate tone, or generic hype.',
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
    'Important: Do NOT always explain what Base is. Base can be background/culture.',
    'You can write about builders, onchain social, trading mood, community humor, or tiny observations, as long as it still fits “Base world”.',
  ].join('\n')

  const formatRules = [
    `Format template: ${args.format.name} — ${args.format.desc}`,
    `Target length: ${args.format.targetChars}`,
    'Template hard rules:',
    ...args.format.hardRules.map((r) => `- ${r}`),
  ].join('\n')

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
    const category = pickWithHistory(
      categoryPool.map((c) => ({ c })),
      recentCats,
      (x) => x.c
    ).c

    const format = pickWithHistory(FORMAT_TEMPLATES, recentFormats, (t) => t.key)
    const style = STYLE_SEEDS[Math.floor(Math.random() * STYLE_SEEDS.length)]

    let text = ''

    // Try a few times until we get something not-too-similar.
    const maxAttempts = 3
    let lastErr: any = null
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const catForAttempt = attempt === 1 ? category : pickWithHistory(
        categoryPool.map((c) => ({ c })),
        [category, ...recentCats],
        (x) => x.c
      ).c

      const fmtForAttempt = attempt === 1 ? format : pickWithHistory(
        FORMAT_TEMPLATES,
        [format.key, ...recentFormats],
        (t) => t.key
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
