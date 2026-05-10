/**
 * gemini-search.ts
 *
 * Uses Gemini 2.5 Flash Lite (via Vercel AI Gateway) with Google Search grounding
 * to fetch current, factual context about the Base ecosystem.
 *
 * The result is a short plain-text summary of what is actually happening on/around
 * Base right now — no hallucinations, grounded in real web results.
 *
 * This context is then passed to OpenAI for the actual post generation.
 *
 * Caching: results are cached in Redis for 2 hours per topic to avoid
 * hammering the Gemini API on every generation request.
 *
 * ENV VARS REQUIRED:
 *   AI_GATEWAY_API_KEY — Vercel AI Gateway API key
 *   AI_GATEWAY_MODEL   — optional override, default: google/gemini-2.5-flash-lite-preview-06-17
 */

import { getRedisClient } from './store.js'

const CACHE_TTL_SECONDS = 2 * 60 * 60 // 2 hours
const FETCH_TIMEOUT_MS = 12000

export type SearchContext = {
  summary: string       // plain text summary, 3-6 sentences
  query: string         // the search query that was used
  fromCache: boolean
  skipped: boolean      // true if Gemini key missing or search disabled
}

// Topic → search query mapping
// Randomly picks one query per topic each time, to keep variety
const TOPIC_QUERIES: Record<string, string[]> = {
  'onchain-social': [
    'Base blockchain Farcaster activity latest news 2025',
    'Warpcast Base ecosystem growth recent updates',
    'onchain social Base mini apps trending this week',
  ],
  'builders': [
    'Base blockchain developer activity new deployments 2025',
    'Base ecosystem new projects launched recently',
    'Base chain builder tools SDK updates 2025',
  ],
  'fees-speed': [
    'Base blockchain gas fees transaction data today',
    'Base L2 transaction speed throughput recent stats',
    'Base chain fee revenue onchain metrics 2025',
  ],
  'defi': [
    'Base blockchain DeFi TVL protocols latest 2025',
    'Base DeFi activity DEX volume stablecoin news recent',
    'Base chain yield farming lending protocols update 2025',
  ],
  'security': [
    'Base blockchain security audits smart contract updates 2025',
    'Base ecosystem wallet safety recent developments',
  ],
  'nft-creator': [
    'Base blockchain NFT minting activity creators 2025',
    'Base chain NFT collections trending recent weeks',
  ],
  'culture': [
    'Base blockchain community vibes memes culture 2025',
    'Base crypto Twitter community highlights recent',
  ],
  'onboarding': [
    'Base blockchain new user onboarding wallet growth 2025',
    'Base chain adoption mainstream users recent stats',
  ],
}

function pickQuery(topicTag: string): string {
  const queries = TOPIC_QUERIES[topicTag] || TOPIC_QUERIES['builders']
  return queries[Math.floor(Math.random() * queries.length)]
}

function cacheKey(query: string): string {
  // Normalize query to make cache key stable for similar queries
  return `gemini:search:${query.toLowerCase().replace(/\s+/g, '_').slice(0, 80)}`
}

/**
 * Calls Gemini via Vercel AI Gateway with Google Search grounding enabled.
 * Returns a concise factual summary of what is currently happening on Base
 * related to the given topic.
 */
async function fetchGeminiSearchSummary(query: string): Promise<string> {
  const apiKey = process.env.AI_GATEWAY_API_KEY
  if (!apiKey) throw new Error('AI_GATEWAY_API_KEY not set')

  const model = process.env.AI_GATEWAY_MODEL || 'google/gemini-3.1-flash-lite'
  const baseURL = 'https://ai-gateway.vercel.sh/v1'

  const systemPrompt = [
    'You are a research assistant that summarizes current news and on-chain activity about the Base blockchain ecosystem.',
    'Use your web search capability to find real, recent information.',
    'Return ONLY a plain-text summary of 3–6 sentences.',
    'Rules:',
    '- Include only verified, factual information from search results.',
    '- Do NOT invent numbers, TVL figures, user counts, or announcements.',
    '- Do NOT use markdown, bullet points, or headers.',
    '- Do NOT editorialize. Just report what you found.',
    '- Keep it short and dense with actual signal. Skip generic statements.',
  ].join('\n')

  const userPrompt = `Search for and summarize: ${query}\n\nReturn only the factual summary. No preamble.`

  // Gemini grounding via Vercel AI Gateway uses provider_options
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 300,
    // Vercel AI Gateway provider options for Gemini grounding
    provider_options: {
      google: {
        tools: [{ google_search: {} }],
      },
    },
  }

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let resp: Response
  try {
    resp = await fetch(`${baseURL}/chat/completions`, {
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

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '')
    throw new Error(`Gemini API error ${resp.status}: ${errText.slice(0, 200)}`)
  }

  const data: any = await resp.json()
  const text = String(data?.choices?.[0]?.message?.content || '').trim()
  if (!text) throw new Error('Empty response from Gemini')
  return text
}

/**
 * Main export: returns a SearchContext with a grounded summary about Base.
 * Always resolves (never throws) — returns skipped:true if not configured.
 *
 * @param topicTag  - topic from TOPIC_TAGS (e.g. 'defi', 'builders')
 * @param forceSearch - if true, skip cache (for testing)
 */
export async function getBaseSearchContext(
  topicTag: string,
  forceSearch = false,
): Promise<SearchContext> {
  const apiKey = process.env.AI_GATEWAY_API_KEY
  if (!apiKey) {
    return { summary: '', query: '', fromCache: false, skipped: true }
  }

  const query = pickQuery(topicTag)
  const redis = getRedisClient()
  const key = cacheKey(query)

  // Check cache first
  if (!forceSearch && redis) {
    try {
      const cached = await redis.get<string>(key)
      if (cached) {
        const summary = typeof cached === 'string' ? cached : JSON.stringify(cached)
        if (summary.length > 20) {
          return { summary, query, fromCache: true, skipped: false }
        }
      }
    } catch { /* ignore cache errors */ }
  }

  // Fetch fresh
  try {
    const summary = await fetchGeminiSearchSummary(query)

    // Cache result
    if (redis) {
      try {
        await redis.set(key, summary, { ex: CACHE_TTL_SECONDS })
      } catch { /* ignore */ }
    }

    return { summary, query, fromCache: false, skipped: false }
  } catch (err) {
    // Search failed — return skipped so generation continues without it
    return { summary: '', query, fromCache: false, skipped: true }
  }
}
