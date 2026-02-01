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

type StyleDeck = {
  id: string
  label: string
  // concise formatting constraints to keep the output human + varied
  formatGuide: string
  // helps the model pick different rhetorical devices
  anglePrompts: string[]
  // relative probability of selecting this style
  weight: number
  // token budget guidance (we still post-process + clamp chars)
  maxTokens: number
  // roughly how long (in characters) the final cast should be
  maxChars: number
}

const STYLE_DECK: StyleDeck[] = [
  {
    id: 'one-liner',
    label: 'Dry humor one-liner',
    formatGuide: '1–2 lines. No bullets. No intro paragraph. Punchline is the last line.',
    anglePrompts: ['small irony', 'deadpan observation', 'subtle flex, but humble'],
    weight: 1.0,
    maxTokens: 90,
    maxChars: 220,
  },
  {
    id: 'micro-story',
    label: 'Tiny story',
    formatGuide: '3–5 short lines. Story beats. Line breaks matter. End with a calm takeaway.',
    anglePrompts: ['moment from today', 'builder frustration -> aha', 'small win onchain'],
    weight: 1.0,
    maxTokens: 150,
    maxChars: 360,
  },
  {
    id: 'checklist',
    label: 'Checklist',
    formatGuide: 'Use 3–5 lines like "-" or "- [ ]". No long paragraphs.',
    anglePrompts: ['shipping checklist', 'onboarding checklist', 'smart habits'],
    weight: 0.85,
    maxTokens: 170,
    maxChars: 420,
  },
  {
    id: 'contrast',
    label: 'Then vs now',
    formatGuide: 'Use “Then →” / “Now →” (or similar) 2–4 lines. Very readable. No fluff.',
    anglePrompts: ['fees', 'ux', 'dev velocity', 'onchain social'],
    weight: 0.9,
    maxTokens: 150,
    maxChars: 360,
  },
  {
    id: 'based-notes',
    label: 'Based notes (rare)',
    formatGuide: 'Use 2–4 lines like “Based 1: …” “Based 2: …”. Keep it short. No long paragraphs.',
    anglePrompts: ['two quick observations', 'two lessons', 'two small wins'],
    weight: 0.25,
    maxTokens: 160,
    maxChars: 420,
  },
  {
    id: 'question-hook',
    label: 'Question hook',
    formatGuide: 'Start with 1 question. Then 2–4 lines. End with a simple call for replies.',
    anglePrompts: ['favorite Base app category', 'builder tip request', 'what are you watching'],
    weight: 0.75,
    maxTokens: 160,
    maxChars: 420,
  },
]

const SL0P_PHRASES = [
  'unlock',
  'game changer',
  'revolutionize',
  'next level',
  'the future is here',
  'join us',
  'don\'t sleep on',
  'wagmi',
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
  'gm',
  'hot take',
  'unpopular opinion',
  'here\'s the thing',
  'let\'s talk about',
  'thread',
]

function twitterify(text: string) {
  let out = String(text || '').trim()
  if (!out) return out

  // If the model already used line breaks, keep them (just normalize).
  if (out.includes('\n')) {
    out = out.replace(/\n{3,}/g, '\n\n')
    return out.trim()
  }

  // Split into "sentences" and group them into 1–2 sentence chunks,
  // separated by a blank line (Twitter/Farcaster style).
  const parts = out.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [out]
  const sentences = parts.map((s) => s.trim()).filter(Boolean)
  if (sentences.length <= 2) return out

  const blocks: string[] = []
  for (let i = 0; i < sentences.length; i += 2) {
    blocks.push(sentences.slice(i, i + 2).join(' '))
  }
  return blocks.join('\n\n').trim()
}

function clampChars(text: string, maxChars: number) {
  const t = String(text || '').trim()
  if (!t) return t
  if (t.length <= maxChars) return t
  // Trim without cutting mid-word too aggressively.
  const slice = t.slice(0, maxChars)
  const lastBreak = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf(' '))
  if (lastBreak < Math.floor(maxChars * 0.7)) return slice.trimEnd() + '…'
  return slice.slice(0, lastBreak).trimEnd() + '…'
}

function ngramSet(s: string, n = 4) {
  const t = String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
  const out = new Set<string>()
  if (t.length < n) return out
  for (let i = 0; i <= t.length - n; i++) out.add(t.slice(i, i + n))
  return out
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  const union = a.size + b.size - inter
  return union ? inter / union : 0
}

function pickTopicTag(posts: Array<{ text: string }>, recentTags: string[]) {
  const corpus = posts.map((p) => String(p.text || '').toLowerCase()).join(' \n ')
  const scored = TOPIC_TAGS.map((t) => {
    let score = 0
    for (const k of t.keywords) if (corpus.includes(k)) score++
    return { tag: t.tag, score }
  }).filter((x) => x.score > 0)

  // Prefer topics seen in the dataset, but avoid recently used tags.
  const sorted = scored.sort((a, b) => b.score - a.score)
  for (const s of sorted) {
    if (!recentTags.includes(s.tag)) return s.tag
  }

  // Fallback: random tag not recently used.
  const candidates = TOPIC_TAGS.map((t) => t.tag).filter((t) => !recentTags.includes(t))
  const pool = candidates.length ? candidates : TOPIC_TAGS.map((t) => t.tag)
  return pool[Math.floor(Math.random() * pool.length)]
}

function pickStyle(recentStyleIds: string[]) {
  const candidates = STYLE_DECK.filter((s) => !recentStyleIds.includes(s.id))
  const pool = candidates.length ? candidates : STYLE_DECK

  // Weighted choice so we can keep some formats rare.
  const total = pool.reduce((acc, s) => acc + (Number(s.weight) || 0), 0)
  const r = Math.random() * (total || pool.length)
  let cur = 0
  for (const s of pool) {
    cur += total ? (Number(s.weight) || 0) : 1
    if (r <= cur) return s
  }
  return pool[pool.length - 1]
}

function shuffleInPlace<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function pickSourcePosts(posts: Array<{ author: string; text: string }>, topicTag: string, max = 12) {
  const tag = TOPIC_TAGS.find((t) => t.tag === topicTag)
  const kws = (tag?.keywords || []).map((k) => k.toLowerCase())

  const hits: Array<{ author: string; text: string }> = []
  const rest: Array<{ author: string; text: string }> = []
  for (const p of posts) {
    const t = String(p.text || '').toLowerCase()
    const matched = kws.some((k) => t.includes(k))
    ;(matched ? hits : rest).push(p)
  }

  shuffleInPlace(hits)
  shuffleInPlace(rest)

  // Mix: prefer a few on-topic examples, but include off-topic for stylistic variety.
  const out = [...hits.slice(0, Math.ceil(max / 2)), ...rest.slice(0, max)]
  shuffleInPlace(out)
  return out.slice(0, max)
}

function postProcessOutput(text: string) {
  let out = String(text || '').trim()
  if (!out) return out

  // Enforce: no em/en dashes. Use ellipsis instead.
  out = out.replace(/[\u2014\u2013]/g, '...')
  // Normalize unicode ellipsis to three dots so it feels more "human typed".
  out = out.replace(/\u2026/g, '...')

  // De-paragraphify: make it look like a Farcaster/Twitter post.
  out = twitterify(out)

  // Final cleanup.
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  return out
}

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
  style: StyleDeck
  topicTag: string
  recentTexts: string[]
}) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('Server missing OPENAI_API_KEY')

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

  const seed = crypto.randomUUID()
  const style = args.style
  const angle = style.anglePrompts[Math.floor(Math.random() * style.anglePrompts.length)]

  const sourceBlock = args.posts
    .slice(0, 12)
    .map((p, i) => `${i + 1}. @${p.author}: ${p.text}`)
    .join('\n')

  const system = [
    'You are writing a single Farcaster/Twitter-style post for the Base ecosystem.',
    'It must feel human-written: specific, a little clever, and NOT like an AI template.',
    'Hard rules:',
    '- Do NOT copy any source post. Do NOT paraphrase too closely.',
    '- Do NOT use long dashes (—/–). Use "..." for pauses.',
    '- Do NOT use generic hype/marketing lines. Avoid obvious AI phrasing.',
    `- Avoid these slop phrases: ${SL0P_PHRASES.join(', ')}.`,
    '- No fake announcements, token launch rumors, made-up metrics, or “insider alpha”. Stay truthful and general when unsure.',
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
    'Recent posts I already generated for this user (avoid anything too similar):',
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
    '- It must be clearly about Base by the end, but NOT forced. Mention “Base” naturally once (or twice max).',
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

  const cleaned = clampChars(postProcessOutput(out), style.maxChars)

  // Final safety: avoid banned openers (soft enforcement)
  const lower = cleaned.toLowerCase().trim()
  for (const opener of BANNED_OPENERS) {
    if (lower.startsWith(opener)) {
      // Nudge by adding a subtle prefix to break template feel
      return postProcessOutput(`Noticed something: ${cleaned}`)
    }
  }

  return cleaned
}

async function openaiRewriteAddBase(args: {
  original: string
  style: StyleDeck
  userId: string
}) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('Server missing OPENAI_API_KEY')
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

  const system = [
    'Rewrite the user text into a Farcaster/Twitter-style post.',
    'Keep the same format and tone, but add a subtle Base reference so it clearly relates to Base.',
    'Do NOT add hype, no fake claims, no hashtags. Keep it human.',
    'Output only the post text.',
  ].join('\n')

  const user = [
    `Keep this formatting style: ${args.style.label} (${args.style.id})`,
    `Max length: ${args.style.maxChars} chars`,
    '',
    'Text to rewrite:',
    args.original,
  ].join('\n')

  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.8,
    max_tokens: Math.max(90, Math.min(140, args.style.maxTokens)),
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
  if (!out) return args.original
  return clampChars(postProcessOutput(out), args.style.maxChars)
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
    if (user.credits < 1) {
      return json(res, 402, { error: 'Not enough credits', credits: user.credits })
    }

    let charged = false
    try {
      await adjustCredits(userId, -1)
      charged = true

      const apifyItems = await fetchApifyPosts(limit)
      const posts = normalizePosts(apifyItems, 25)

      const recent = await getRecent(userId, 'post', 12)
      const recentStyleIds = recent.map((r) => String(r?.styleId || '')).filter(Boolean)
      const recentTags = recent.map((r) => String(r?.topicTag || '')).filter(Boolean)
      const recentTexts = recent
        .map((r) => String(r?.text || '').trim())
        .filter(Boolean)
        .slice(0, 4)

      let usedStyle = pickStyle(recentStyleIds.slice(0, 3))
      let usedTopicTag = pickTopicTag(posts, recentTags.slice(0, 4))

      const chosenSources = pickSourcePosts(
        posts.map((p) => ({ author: p.author, text: p.text })),
        usedTopicTag,
        12
      )

      let text = await openaiGenerate({
        userId,
        extraPrompt,
        posts: chosenSources,
        style: usedStyle,
        topicTag: usedTopicTag,
        recentTexts,
      })

      if (!/\bbase\b/i.test(text)) {
        text = await openaiRewriteAddBase({ original: text, style: usedStyle, userId })
      }

      const newSet = ngramSet(text)
      const tooSimilar = recentTexts.some((t) => jaccard(newSet, ngramSet(t)) > 0.58)
      if (tooSimilar) {
        const altStyle = pickStyle([usedStyle.id, ...recentStyleIds].slice(0, 5))
        const altTag = pickTopicTag(posts, [usedTopicTag, ...recentTags].slice(0, 6))
        const altSources = pickSourcePosts(
          posts.map((p) => ({ author: p.author, text: p.text })),
          altTag,
          12
        )
        text = await openaiGenerate({
          userId,
          extraPrompt,
          posts: altSources,
          style: altStyle,
          topicTag: altTag,
          recentTexts,
        })
        if (!/\bbase\b/i.test(text)) {
          text = await openaiRewriteAddBase({ original: text, style: altStyle, userId })
        }
        usedStyle = altStyle
        usedTopicTag = altTag
      }

      await pushRecent(userId, 'post', { ts: Date.now(), styleId: usedStyle.id, topicTag: usedTopicTag, text }, 12)

      await incrementMetric(userId, 'postCount', 1, 2)
      await logCreditSpend({ userId, creditsSpent: 1, postDelta: 1 })

      const after = await getOrCreateUser(userId)

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
        try { await adjustCredits(userId, +1) } catch { /* ignore */ }
      }
      return json(res, 500, { error: e?.message || 'Generation failed' })
    }
  } catch (e: any) {
    // Absolute last-resort: never crash the function.
    return json(res, 500, { error: e?.message || 'Server error' })
  }
}
