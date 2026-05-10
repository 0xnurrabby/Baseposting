/**
 * base-metrics.ts
 *
 * Fetches live Base chain metrics from DeFiLlama (free, no API key required).
 * Caches results in Upstash Redis with a 6-hour TTL so we do not hammer the API.
 * Falls back to hardcoded conservative estimates if the fetch fails.
 *
 * Data sources:
 *   TVL:       https://api.llama.fi/v2/historicalChainTvl/Base
 *   Fees:      https://api.llama.fi/summary/fees/base?dataType=dailyFees
 *   DEX vol:   https://api.llama.fi/overview/dexs/base?dataType=dailyVolume
 */

import { getRedisClient } from './store.js'

const REDIS_KEY = 'base:metrics:v2'
const CACHE_TTL_SECONDS = 6 * 60 * 60 // 6 hours
const FETCH_TIMEOUT_MS = 4000

export type BaseMetrics = {
  tvlUsd: number          // e.g. 4_500_000_000
  tvlFormatted: string    // e.g. "$4.5B"
  dailyFeeUsd: number     // e.g. 80_000
  dailyFeeFormatted: string // e.g. "$80K"
  dexVol24hUsd: number    // e.g. 600_000_000
  dexVolFormatted: string  // e.g. "$600M"
  fetchedAt: string        // ISO timestamp
  stale: boolean           // true if from cache older than 12h or fallback
}

const FALLBACK: BaseMetrics = {
  tvlUsd: 4_500_000_000,
  tvlFormatted: '~$4.5B',
  dailyFeeUsd: 70_000,
  dailyFeeFormatted: '~$70K',
  dexVol24hUsd: 500_000_000,
  dexVolFormatted: '~$500M',
  fetchedAt: new Date().toISOString(),
  stale: true,
}

function formatUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `$${Math.round(n / 1_000_000)}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`
  return `$${Math.round(n)}`
}

async function fetchWithTimeout(url: string): Promise<any> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const r = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally {
    clearTimeout(t)
  }
}

async function fetchFreshMetrics(): Promise<BaseMetrics> {
  const [tvlData, feesData, dexData] = await Promise.allSettled([
    fetchWithTimeout('https://api.llama.fi/v2/historicalChainTvl/Base'),
    fetchWithTimeout('https://api.llama.fi/summary/fees/base?dataType=dailyFees'),
    fetchWithTimeout('https://api.llama.fi/overview/dexs/base?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyVolume'),
  ])

  // TVL — last entry in historical array
  let tvlUsd = FALLBACK.tvlUsd
  if (tvlData.status === 'fulfilled' && Array.isArray(tvlData.value)) {
    const last = tvlData.value[tvlData.value.length - 1]
    if (last?.tvl && Number.isFinite(Number(last.tvl))) {
      tvlUsd = Number(last.tvl)
    }
  }

  // Daily fees
  let dailyFeeUsd = FALLBACK.dailyFeeUsd
  if (feesData.status === 'fulfilled') {
    const v = feesData.value?.total24h
    if (Number.isFinite(Number(v)) && Number(v) > 0) {
      dailyFeeUsd = Number(v)
    }
  }

  // DEX 24h volume
  let dexVol24hUsd = FALLBACK.dexVol24hUsd
  if (dexData.status === 'fulfilled') {
    const v = dexData.value?.total24h
    if (Number.isFinite(Number(v)) && Number(v) > 0) {
      dexVol24hUsd = Number(v)
    }
  }

  return {
    tvlUsd,
    tvlFormatted: formatUsd(tvlUsd),
    dailyFeeUsd,
    dailyFeeFormatted: formatUsd(dailyFeeUsd),
    dexVol24hUsd,
    dexVolFormatted: formatUsd(dexVol24hUsd),
    fetchedAt: new Date().toISOString(),
    stale: false,
  }
}

/**
 * Returns current Base metrics.
 * Checks Redis cache first; fetches fresh data if cache is missing or expired.
 * Never throws — always returns something useful.
 */
export async function getBaseMetrics(): Promise<BaseMetrics> {
  const redis = getRedisClient()

  // Try cache
  if (redis) {
    try {
      const cached = await redis.get<string>(REDIS_KEY)
      if (cached) {
        const parsed: BaseMetrics = typeof cached === 'string' ? JSON.parse(cached) : cached
        if (parsed?.tvlUsd) return { ...parsed, stale: false }
      }
    } catch {
      // ignore cache errors
    }
  }

  // Fetch fresh
  let metrics: BaseMetrics
  try {
    metrics = await fetchFreshMetrics()
  } catch {
    metrics = { ...FALLBACK, fetchedAt: new Date().toISOString() }
  }

  // Store in cache
  if (redis) {
    try {
      await redis.set(REDIS_KEY, JSON.stringify(metrics), { ex: CACHE_TTL_SECONDS })
    } catch {
      // ignore
    }
  }

  return metrics
}

/**
 * Returns a short human-readable summary string for use in prompts.
 * Example: "TVL: $4.2B | Daily fees: $58K | DEX volume (24h): $480M"
 */
export function metricsToPromptLine(m: BaseMetrics): string {
  const parts = [
    `TVL: ${m.tvlFormatted}`,
    `daily fees paid by users: ${m.dailyFeeFormatted}`,
    `DEX trading volume (24h): ${m.dexVolFormatted}`,
  ]
  if (m.stale) return parts.join(' | ') + ' (approximate)'
  return parts.join(' | ')
}
