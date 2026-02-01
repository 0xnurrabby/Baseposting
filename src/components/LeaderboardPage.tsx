import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronDown, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/Button'
import { Card, CardContent, CardHeader } from '@/components/Card'
import { Skeleton } from '@/components/Skeleton'
import { cn } from '@/lib/cn'
import {
  apiLeaderboard,
  apiGetRewardAddress,
  apiSetRewardAddress,
  type Identity,
  type LeaderboardPeriod,
  type LeaderboardRow,
} from '@/lib/api'

function shortAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function safeName(row: LeaderboardRow) {
  const dn = String(row.displayName || '').trim()
  const un = String(row.username || '').trim()
  if (dn) return dn
  if (un) return `@${un}`
  if (row.fid != null) return `fid:${row.fid}`
  return row.userId
}

function safeHandle(row: LeaderboardRow) {
  const un = String(row.username || '').trim()
  if (un) return `@${un}`
  if (row.fid != null) return `fid:${row.fid}`
  return ''
}

function formatRewardUsd(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) return ''
  const n = Math.round(amount * 100) / 100
  const s = n.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
  return '+' + s + '$'
}

function rewardBadgeClasses(rank: number) {
  // 1st/2nd/3rd all different; rest winners one consistent color
  if (rank === 1) return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
  if (rank === 2) return 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200'
  if (rank === 3) return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
  return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200'
}

function RewardBadge(props: { rank: number; rewardUsd?: number | null }) {
  const v = props.rewardUsd
  if (v == null || !Number.isFinite(v) || v <= 0) return null
  return (
    <span
      className={cn(
        'ml-2 inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-extrabold tracking-tight animate-wiggle',
        rewardBadgeClasses(props.rank)
      )}
      title="Estimated giveaway reward"
    >
      {formatRewardUsd(v)}
    </span>
  )
}

export function LeaderboardPage(props: {
  identity: Identity
  dark: boolean
  onToggleTheme: () => void
  onClose: () => void
}) {
  const [period, setPeriod] = useState<LeaderboardPeriod>('7d')
  const [openPeriod, setOpenPeriod] = useState(false)
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<LeaderboardRow[]>([])
  const [meta, setMeta] = useState<any>({})

  // Reward address UX
  const [myAddr, setMyAddr] = useState<string | null>(null)
  const [addrOpen, setAddrOpen] = useState(false)
  const [addrInput, setAddrInput] = useState('')
  const [savingAddr, setSavingAddr] = useState(false)

  const fid = props.identity.fid

  const canSubmitAddr = typeof fid === 'number' && Number.isFinite(fid)

  async function loadLeaderboard(p: LeaderboardPeriod) {
    setLoading(true)
    try {
      const data = await apiLeaderboard(p)
      setEntries(Array.isArray(data.entries) ? data.entries : [])
      setMeta(data.meta || {})
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load leaderboard')
      setEntries([])
      setMeta({})
    } finally {
      setLoading(false)
    }
  }

  async function loadMyAddress() {
    if (!canSubmitAddr || !fid) return
    try {
      const data = await apiGetRewardAddress(fid)
      setMyAddr(data.baseAddress || null)
      if (data.baseAddress) setAddrInput(data.baseAddress)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    void loadLeaderboard(period)
    // Auto-refresh every 60s so UI stays fresh while the cron runs every 10 min.
    const t = setInterval(() => void loadLeaderboard(period), 60_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period])

  useEffect(() => {
    void loadMyAddress()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fid])

  const updatedLabel = useMemo(() => {
    const v = String(meta?.updatedAt || '').trim()
    if (!v) return ''
    try {
      const d = new Date(v)
      if (Number.isNaN(d.getTime())) return ''
      return d.toLocaleString()
    } catch {
      return ''
    }
  }, [meta])

  const top3 = entries.slice(0, 3)
  const rest = entries.slice(3)

  const addrCtaVariant = myAddr ? 'success' : 'attention'
  const addrCtaText = myAddr ? 'Base address submitted ✅' : 'Submit Base address for reward'

  async function saveAddress() {
    const value = addrInput.trim()
    if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
      toast.error('Please enter a valid Base address (0x...)')
      return
    }

    if (!canSubmitAddr) {
      toast.error('Open inside Farcaster / Base Mini App to submit')
      return
    }

    setSavingAddr(true)
    try {
      const resp = await apiSetRewardAddress(props.identity, value)
      setMyAddr(resp.baseAddress)
      setAddrOpen(false)
      toast.success('Address saved')

      // Update any visible row instantly
      setEntries((prev) =>
        prev.map((r) => {
          if (r.fid && fid && r.fid === fid) return { ...r, baseAddress: value }
          return r
        })
      )
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save address')
    } finally {
      setSavingAddr(false)
    }
  }

  return (
    <div>
      {/* Top bar */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">Leaderboard</div>
          <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Top 50 users by credits spent on post + photo generation.
            {updatedLabel ? <span className="ml-2 text-xs">Updated: {updatedLabel}</span> : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" aria-label="Refresh" onClick={() => void loadLeaderboard(period)} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading ? 'animate-spin' : '')} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>

          <Button variant="ghost" aria-label="Toggle theme" onClick={props.onToggleTheme}>
            {props.dark ? 'Light' : 'Dark'}
          </Button>

          <Button variant="ghost" aria-label="Close" onClick={props.onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Period selector + address CTA */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="relative">
          <button
            className="flex w-full items-center justify-between rounded-2xl border border-zinc-200 bg-white/70 px-4 py-3 text-sm font-semibold text-zinc-800 shadow-sm backdrop-blur transition hover:bg-white dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-100"
            onClick={() => setOpenPeriod((v) => !v)}
          >
            <div className="flex flex-col items-start">
              <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Range</span>
              <span className="mt-0.5">
                {period === '7d' ? 'Last 7 days' : 'Previous week'}
              </span>
            </div>
            <ChevronDown className={cn('h-4 w-4 transition', openPeriod ? 'rotate-180' : '')} />
          </button>

          {openPeriod ? (
            <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
              <button
                className={cn(
                  'w-full px-4 py-3 text-left text-sm font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-900',
                  period === '7d' ? 'text-zinc-900 dark:text-white' : 'text-zinc-700 dark:text-zinc-200'
                )}
                onClick={() => {
                  setPeriod('7d')
                  setOpenPeriod(false)
                }}
              >
                Last 7 days
              </button>
              <button
                className={cn(
                  'w-full px-4 py-3 text-left text-sm font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-900',
                  period === 'prev' ? 'text-zinc-900 dark:text-white' : 'text-zinc-700 dark:text-zinc-200'
                )}
                onClick={() => {
                  setPeriod('prev')
                  setOpenPeriod(false)
                }}
              >
                Previous week
              </button>
            </div>
          ) : null}
        </div>

        <div>
          <Button
            variant={addrCtaVariant as any}
            className={cn('w-full', !myAddr ? 'animate-wiggle' : '')}
            disabled={!canSubmitAddr}
            onClick={() => {
              if (!canSubmitAddr) {
                toast.message('Open inside Farcaster / Base Mini App to submit')
                return
              }
              setAddrOpen(true)
              setAddrInput((myAddr || '').trim())
            }}
          >
            {addrCtaText}
          </Button>
          <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            Your Base address is used only for reward distribution. You can edit anytime.
          </div>
        </div>
      </div>

      {/* Top 3 */}
      <Card className="mt-6 overflow-hidden">
        <CardHeader>
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Top 3</div>
          <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Big spenders this period ✨</div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : top3.length === 0 ? (
            <div className="text-sm text-zinc-600 dark:text-zinc-300">No data yet. Generate a post or photo to enter the leaderboard.</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              {top3.map((r, idx) => (
                <motion.div
                  key={`${r.userId}:${idx}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, delay: idx * 0.04 }}
                  className="rounded-2xl border border-zinc-200 bg-white/70 p-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/50"
                >
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="h-10 w-10 overflow-hidden rounded-2xl bg-zinc-200 dark:bg-zinc-800">
                        {r.pfpUrl ? <img src={r.pfpUrl} alt="" className="h-full w-full object-cover" /> : null}
                      </div>
                      <div className="absolute -bottom-2 -right-2 rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-xs font-bold text-zinc-900 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-white">
                        #{idx + 1}
                      </div>
                    </div>

                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center">
                        <div className="truncate text-sm font-semibold text-zinc-900 dark:text-white">{safeName(r)}</div>
                        <RewardBadge rank={idx + 1} rewardUsd={r.rewardUsd} />
                      </div>
                      <div className="truncate text-xs text-zinc-600 dark:text-zinc-400">{safeHandle(r)}</div>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-xl bg-zinc-50 px-2 py-2 text-center dark:bg-zinc-900">
                      <div className="font-bold text-zinc-900 dark:text-white">{r.creditsSpent}</div>
                      <div className="text-zinc-500 dark:text-zinc-400">spent</div>
                    </div>
                    <div className="rounded-xl bg-zinc-50 px-2 py-2 text-center dark:bg-zinc-900">
                      <div className="font-bold text-zinc-900 dark:text-white">{r.postCount}</div>
                      <div className="text-zinc-500 dark:text-zinc-400">posts</div>
                    </div>
                    <div className="rounded-xl bg-zinc-50 px-2 py-2 text-center dark:bg-zinc-900">
                      <div className="font-bold text-zinc-900 dark:text-white">{r.photoCount}</div>
                      <div className="text-zinc-500 dark:text-zinc-400">photos</div>
                    </div>
                  </div>

                  {r.baseAddress ? (
                    <div className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
                      Reward: <span className="font-semibold text-zinc-900 dark:text-zinc-200">{shortAddress(r.baseAddress)}</span>
                    </div>
                  ) : null}
                </motion.div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Full list */}
      <Card className="mt-6">
        <CardHeader>
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Top 50</div>
          <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Sorted by credits spent</div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {entries.map((r, idx) => (
                <div
                  key={`${r.userId}:${idx}`}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white/70 px-3 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/50"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="w-7 text-center text-sm font-bold text-zinc-900 dark:text-white">{idx + 1}</div>
                    <div className="h-10 w-10 overflow-hidden rounded-2xl bg-zinc-200 dark:bg-zinc-800">
                      {r.pfpUrl ? <img src={r.pfpUrl} alt="" className="h-full w-full object-cover" /> : null}
                    </div>
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center">
                        <div className="truncate text-sm font-semibold text-zinc-900 dark:text-white">{safeName(r)}</div>
                        <RewardBadge rank={idx + 1} rewardUsd={r.rewardUsd} />
                      </div>
                      <div className="truncate text-xs text-zinc-600 dark:text-zinc-400">
                        {r.postCount} posts • {r.photoCount} photos
                        {r.baseAddress ? <span className="ml-2">• {shortAddress(r.baseAddress)}</span> : null}
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <div className="text-sm font-bold text-zinc-900 dark:text-white">{r.creditsSpent}c</div>
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">spent</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Address modal */}
      {addrOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="w-full max-w-xl rounded-3xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold text-zinc-900 dark:text-white">Submit Base address</div>
                <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">We&apos;ll use this only for reward distribution.</div>
              </div>
              <button
                className="rounded-xl p-2 text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
                onClick={() => setAddrOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4">
              <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Base address</label>
              <input
                value={addrInput}
                onChange={(e) => setAddrInput(e.target.value)}
                placeholder="0x..."
                className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none ring-0 focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-white"
              />
              <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Tip: you can paste your Coinbase/Base wallet address.</div>
            </div>

            <div className="mt-4 flex gap-2">
              <Button variant="secondary" className="w-full" onClick={() => setAddrOpen(false)} disabled={savingAddr}>
                Cancel
              </Button>
              <Button variant="attention" className="w-full" onClick={() => void saveAddress()} isLoading={savingAddr}>
                Save
              </Button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </div>
  )
}
