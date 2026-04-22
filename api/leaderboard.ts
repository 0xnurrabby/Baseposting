export const maxDuration = 60

import { handleOptions, json, setCors } from './_lib/http.js'
import { getRewardAddresses, readLeaderboard, type LeaderboardEntry, type LeaderboardPeriod } from './_lib/leaderboard.js'

const responseCache = new Map<string, { ts: number; data: any }>()

function pickPeriod(p: any): LeaderboardPeriod {
  const v = String(p || '').toLowerCase().trim()
  if (v === 'prev' || v === 'previous' || v === 'previous_week') return 'prev'
  return '7d'
}

function readGiveawayConfig(): { totalUsd: number; winners: number } | null {
  const totalUsd = Number(String(process.env.GIVEAWAY_TOTAL_USD || process.env.GIVEAWAY_TOTAL || '').trim())
  const winners = Number(String(process.env.GIVEAWAY_WINNERS || process.env.GIVEAWAY_N || '').trim())

  if (!Number.isFinite(totalUsd) || totalUsd <= 0) return null
  if (!Number.isFinite(winners) || winners <= 0) return null

  return { totalUsd, winners: Math.floor(winners) }
}

function rewardForRank(rank1: number, cfg: { totalUsd: number; winners: number } | null): number | null {
  if (!cfg) return null
  const { totalUsd, winners } = cfg

  if (rank1 < 1 || rank1 > winners) return null
  if (rank1 === 1) return totalUsd * 0.3
  if (rank1 === 2) return totalUsd * 0.15
  if (rank1 === 3) return totalUsd * 0.1
  if (winners <= 3) return null
  return (totalUsd * 0.45) / (winners - 3)
}

export default async function handler(req: any, res: any) {
  setCors(req, res)
  if (handleOptions(req, res)) return

  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method Not Allowed' })
  }

  const qp =
    (req?.query && (req.query.period || req.query.p || req.query.range || req.query.r)) ||
    (req?.url
      ? new URL(req.url, 'http://x').searchParams.get('period') || new URL(req.url, 'http://x').searchParams.get('range')
      : '')
  const period = pickPeriod(qp)
  const cacheKey = `leaderboard:${period}`
  const cached = responseCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < 15000) return json(res, 200, cached.data)

  const giveawayCfg = readGiveawayConfig()
  const { entries, meta } = await readLeaderboard(period)
  const addrMap = await getRewardAddresses(entries.map((e) => e.userId))

  // NO MORE Neynar / Farcaster profile enrichment. We only return addresses.
  const enriched: LeaderboardEntry[] = entries.map((e, idx) => {
    const baseAddress = addrMap[e.userId] || e.baseAddress || null
    const rewardUsd = rewardForRank(idx + 1, giveawayCfg)
    return { ...e, baseAddress, rewardUsd }
  })

  const payload = {
    ok: true,
    period,
    entries: enriched,
    meta: {
      ...(meta || {}),
      giveaway: giveawayCfg ? { totalUsd: giveawayCfg.totalUsd, winners: giveawayCfg.winners } : null,
    },
  }
  responseCache.set(cacheKey, { ts: Date.now(), data: payload })
  return json(res, 200, payload)
}
