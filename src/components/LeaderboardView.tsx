import React, { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, X } from 'lucide-react'

import { Card, CardContent, CardHeader } from '@/components/Card'
import { Button } from '@/components/Button'
import { Skeleton } from '@/components/Skeleton'
import { LeaderboardIcon } from '@/components/LeaderboardIcon'
import {
  apiLeaderboard,
  apiRewardAddressGet,
  apiRewardAddressUpsert,
  type Identity,
  type LeaderboardEntry,
  type LeaderboardRange,
} from '@/lib/api'
import { cn } from '@/lib/cn'
import type { MiniAppUser } from '@/lib/miniapp'

function clamp0(n: any) {
  const v = Number(n)
  return Number.isFinite(v) ? Math.max(0, v) : 0
}

function shortAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function isBaseAddress(addr: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(addr)
}

type Props = {
  identity: Identity
  miniUser: MiniAppUser | null
  onBack: () => void
}

export function LeaderboardView({ identity, miniUser, onBack }: Props) {
  const [range, setRange] = useState<LeaderboardRange>('7d')
  const [loading, setLoading] = useState(true)
  const [updatedAt, setUpdatedAt] = useState('')
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [err, setErr] = useState<string>('')

  // Reward address
  const [addrLoading, setAddrLoading] = useState(false)
  const [addrOpen, setAddrOpen] = useState(false)
  const [addr, setAddr] = useState('')
  const [addrSaved, setAddrSaved] = useState<string>('')
  const [addrError, setAddrError] = useState<string>('')

  const fid = identity.fid || miniUser?.fid || undefined

  const rangeLabel = useMemo(() => {
    if (range === 'prevweek') return 'Previous Week'
    if (range === 'all') return 'All time'
    return 'Last 7 days'
  }, [range])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setErr('')
    void (async () => {
      try {
        const r = await apiLeaderboard(range)
        if (cancelled) return
        setEntries(r.entries || [])
        setUpdatedAt(r.updatedAt || '')
      } catch (e: any) {
        if (cancelled) return
        setErr(String(e?.message || 'Failed to load leaderboard'))
      } finally {
        if (cancelled) return
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [range])

  // Load existing address record
  useEffect(() => {
    let cancelled = false
    if (!fid) return
    void (async () => {
      try {
        const r = await apiRewardAddressGet(fid)
        if (cancelled) return
        const saved = String(r?.record?.address || '').trim()
        setAddrSaved(saved)
        setAddr(saved)
      } catch {
        // ignore
      }
    })()
    return () => {
      cancelled = true
    }
  }, [fid])

  const top3 = useMemo(() => entries.slice(0, 3), [entries])
  const rest = useMemo(() => entries.slice(3), [entries])

  async function saveAddress() {
    setAddrError('')
    const value = addr.trim()
    if (!fid) {
      setAddrError('Farcaster fid not found. Open inside Warpcast/Base app.')
      return
    }
    if (!isBaseAddress(value)) {
      setAddrError('Enter a valid Base address (0x…40 hex)')
      return
    }
    setAddrLoading(true)
    try {
      await apiRewardAddressUpsert({
        fid,
        address: value,
        username: miniUser?.username,
        displayName: miniUser?.displayName,
        pfpUrl: miniUser?.pfpUrl,
      })
      setAddrSaved(value.toLowerCase())
      setAddr(value.toLowerCase())
      setAddrOpen(false)
    } catch (e: any) {
      setAddrError(String(e?.message || 'Failed to save'))
    } finally {
      setAddrLoading(false)
    }
  }

  const submitVariant = addrSaved ? 'success' : 'attention'

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onBack} aria-label="Back">
              <ChevronLeft className="h-4 w-4" />
              Back
            </Button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">Leaderboard</div>
            <span className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs font-semibold text-zinc-700 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-200">
              <LeaderboardIcon className="h-4 w-4" />
              {rangeLabel}
            </span>
          </div>
          <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Top 50 users by credits spent on <span className="font-semibold">Generate</span> and <span className="font-semibold">Generate Photo</span>. Updates every 10 minutes.
          </div>
          {!!updatedAt && (
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">Updated: {updatedAt.replace('T', ' ').slice(0, 19)} UTC</div>
          )}
        </div>

        {/* Range switch */}
        <div className="flex flex-col items-end gap-2">
          <div className="inline-flex items-center rounded-2xl border border-zinc-200 bg-white/70 p-1 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/60">
            <button
              className={cn(
                'rounded-xl px-3 py-1.5 text-xs font-semibold transition',
                range === '7d'
                  ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                  : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900'
              )}
              onClick={() => setRange('7d')}
            >
              7D
            </button>
            <button
              className={cn(
                'rounded-xl px-3 py-1.5 text-xs font-semibold transition',
                range === 'prevweek'
                  ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                  : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900'
              )}
              onClick={() => setRange('prevweek')}
            >
              Prev Week
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="mt-6">
          <Card>
            <CardHeader>
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Loading…</div>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-24 w-full" />
              <Skeleton className="mt-4 h-10 w-full" />
              <Skeleton className="mt-3 h-10 w-full" />
              <Skeleton className="mt-3 h-10 w-full" />
            </CardContent>
          </Card>
        </div>
      ) : err ? (
        <div className="mt-6">
          <Card>
            <CardHeader>
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Couldn’t load leaderboard</div>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-zinc-700 dark:text-zinc-300">{err}</div>
              <div className="mt-4">
                <Button variant="secondary" onClick={() => setRange((r) => (r === '7d' ? 'prevweek' : '7d'))}>
                  Retry
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <>
          {/* Top 3 podium */}
          <div className="mt-6 grid grid-cols-3 gap-3">
            {[1, 0, 2].map((idx, col) => {
              const e = top3[idx]
              if (!e) return <div key={col} />
              const height = idx === 0 ? 'h-32' : 'h-24'
              const badge = idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉'
              return (
                <motion.div key={e.member} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
                  <Card className="overflow-hidden">
                    <CardContent>
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">{badge}</div>
                        <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">#{e.rank}</div>
                      </div>
                      <div className="mt-3 flex flex-col items-center">
                        <div className="relative">
                          <div className={cn('rounded-full bg-zinc-200 dark:bg-zinc-800', idx === 0 ? 'h-16 w-16' : 'h-14 w-14')} />
                          {e.pfpUrl ? (
                            <img
                              src={e.pfpUrl}
                              alt=""
                              className={cn('absolute inset-0 rounded-full object-cover', idx === 0 ? 'h-16 w-16' : 'h-14 w-14')}
                              referrerPolicy="no-referrer"
                            />
                          ) : null}
                        </div>
                        <div className="mt-2 max-w-[10rem] truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{e.name}</div>
                        {e.username ? (
                          <div className="max-w-[10rem] truncate text-xs text-zinc-600 dark:text-zinc-400">@{e.username}</div>
                        ) : null}
                      </div>

                      <div className={cn('mt-4 rounded-xl border border-zinc-200 bg-white/60 p-3 text-center dark:border-zinc-800 dark:bg-zinc-950/60', height)}>
                        <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Spent</div>
                        <div className="mt-1 text-xl font-extrabold tracking-tight text-zinc-900 dark:text-white">{clamp0(e.spentCredits).toLocaleString()}</div>
                        <div className="text-xs text-zinc-600 dark:text-zinc-400">CREDITS</div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              )
            })}
          </div>

          {/* List */}
          <Card className="mt-4">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Top 50</div>
                <div className="text-xs text-zinc-600 dark:text-zinc-400">Credits spent</div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {rest.map((e) => (
                  <div key={e.member} className="flex items-center justify-between gap-3 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="w-10 text-xs font-bold text-zinc-500 dark:text-zinc-500">#{e.rank}</div>
                      <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                        {e.pfpUrl ? (
                          <img src={e.pfpUrl} alt="" className="h-9 w-9 rounded-full object-cover" referrerPolicy="no-referrer" />
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{e.name}</div>
                        {e.username ? (
                          <div className="truncate text-xs text-zinc-600 dark:text-zinc-400">@{e.username}</div>
                        ) : null}
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      <div className="text-sm font-extrabold text-zinc-900 dark:text-white">{clamp0(e.spentCredits).toLocaleString()}</div>
                      <div className="text-xs text-zinc-600 dark:text-zinc-400">CREDITS</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Submit address CTA */}
          <div className="mt-6">
            <Card>
              <CardHeader>
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Rewards</div>
                <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                  Submit your Base address so we can send rewards to the winners.
                </div>
              </CardHeader>
              <CardContent>
                {addrSaved ? (
                  <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100">
                    Saved: <span className="font-semibold">{shortAddress(addrSaved)}</span>
                    <span className="ml-2 text-xs opacity-80">(tap button to edit)</span>
                  </div>
                ) : (
                  <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100">
                    Not submitted yet.
                  </div>
                )}

                <motion.div
                  animate={
                    addrSaved
                      ? { x: 0 }
                      : { x: [0, -2, 2, -2, 2, 0] }
                  }
                  transition={addrSaved ? { duration: 0 } : { duration: 0.45, repeat: Infinity, repeatDelay: 3 }}
                >
                  <Button
                    className="w-full"
                    variant={submitVariant}
                    onClick={() => setAddrOpen(true)}
                    disabled={!fid}
                  >
                    Submit Base address
                  </Button>
                </motion.div>

                {!fid ? (
                  <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                    Open inside Warpcast/Base app so we can detect your Farcaster fid.
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          {/* Address modal */}
          <AnimatePresence>
            {addrOpen ? (
              <motion.div
                className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <motion.div
                  className="w-full max-w-lg"
                  initial={{ y: 18, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 18, opacity: 0 }}
                >
                  <Card>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Submit Base address</div>
                          <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">You can edit anytime. Saved instantly.</div>
                        </div>
                        <Button variant="ghost" onClick={() => setAddrOpen(false)} aria-label="Close">
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div>
                        <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Base address</label>
                        <input
                          value={addr}
                          onChange={(e) => setAddr(e.target.value)}
                          placeholder="0x..."
                          className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none ring-zinc-400/40 focus:ring-2 dark:border-zinc-800 dark:bg-zinc-950 dark:text-white"
                          autoCapitalize="off"
                          autoCorrect="off"
                          spellCheck={false}
                        />
                        {addrError ? (
                          <div className="mt-2 text-xs font-semibold text-rose-600">{addrError}</div>
                        ) : null}
                      </div>

                      <div className="mt-4 flex gap-2">
                        <Button className="w-full" variant="secondary" onClick={() => setAddrOpen(false)}>
                          Cancel
                        </Button>
                        <Button className="w-full" variant={addrSaved ? 'success' : 'attention'} isLoading={addrLoading} onClick={() => void saveAddress()}>
                          Save
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </>
      )}
    </div>
  )
}
