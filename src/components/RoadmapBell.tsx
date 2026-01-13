import React, { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Bell, X } from 'lucide-react'
import { createPortal } from 'react-dom'

import { ROADMAP, ROADMAP_SEEN_KEY, type RoadmapItem, type RoadmapTone } from '@/lib/roadmap'

function toneClasses(tone: RoadmapTone) {
  switch (tone) {
    case 'green':
      return {
        dot: 'bg-emerald-500',
        glow: 'shadow-[0_0_0_6px_rgba(16,185,129,0.14)]',
        line: 'from-emerald-500/0 via-emerald-500/35 to-emerald-500/0',
        card:
          'border-emerald-200/60 bg-emerald-50/60 ring-1 ring-inset ring-white/40 dark:border-emerald-900/40 dark:bg-emerald-950/25 dark:ring-white/5',
        badge: 'bg-emerald-600 text-white',
      }
    case 'red':
      return {
        dot: 'bg-rose-500',
        glow: 'shadow-[0_0_0_6px_rgba(244,63,94,0.16)]',
        line: 'from-rose-500/0 via-rose-500/35 to-rose-500/0',
        card:
          'border-rose-200/60 bg-rose-50/60 ring-1 ring-inset ring-white/40 dark:border-rose-900/40 dark:bg-rose-950/25 dark:ring-white/5',
        badge: 'bg-rose-600 text-white',
      }
    default:
      return {
        dot: 'bg-zinc-400',
        glow: 'shadow-[0_0_0_6px_rgba(113,113,122,0.10)]',
        line: 'from-zinc-500/0 via-zinc-500/25 to-zinc-500/0',
        card:
          'border-zinc-200/70 bg-white/60 ring-1 ring-inset ring-white/50 dark:border-zinc-800/70 dark:bg-zinc-950/35 dark:ring-white/5',
        badge: 'bg-zinc-800 text-white dark:bg-white dark:text-zinc-900',
      }
  }
}

function ItemRow({ item }: { item: RoadmapItem }) {
  const c = toneClasses(item.tone)
  const isLatest = item.tone === 'red'

  return (
    <div className="group relative flex gap-3">
      {/* timeline dot */}
      <div className="relative mt-1.5 flex w-9 justify-center">
        <div className={`relative h-3.5 w-3.5 rounded-full ${c.dot} ${c.glow}`}>
          <div className="absolute inset-[-5px] rounded-full ring-1 ring-inset ring-white/65 dark:ring-white/10" />
        </div>
      </div>

      <div
        className={
          `w-full rounded-3xl border p-4 shadow-[0_10px_30px_rgba(0,0,0,0.08)] ` +
          `backdrop-blur-xl transition will-change-transform ${c.card} ` +
          `group-hover:-translate-y-[1px] group-hover:shadow-[0_14px_40px_rgba(0,0,0,0.10)]`
        }
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold tracking-wide text-zinc-500 dark:text-zinc-400">
              {item.date}
            </div>
            <div className="mt-1 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {item.title}
            </div>
          </div>
          {isLatest ? (
            <span
              className={
                `shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold ${c.badge} ` +
                `shadow-[0_8px_18px_rgba(244,63,94,0.25)]`
              }
            >
              Latest
            </span>
          ) : item.tone === 'green' ? (
            <span
              className={
                `shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold ${c.badge} ` +
                `shadow-[0_8px_18px_rgba(16,185,129,0.20)]`
              }
            >
              Done
            </span>
          ) : null}
        </div>

        <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          {item.text}
        </div>
      </div>
    </div>
  )
}

export function RoadmapBell() {
  
  // Some mini-app hosts (and some mobile webviews) apply transforms to parent containers.
  // That can break CSS `position: fixed` and make the bell appear "off-screen".
  // Rendering via a portal to <body> keeps the floating UI reliably visible.
  const [mounted, setMounted] = useState(false)

  const [open, setOpen] = useState(false)
  const [seenLatestId, setSeenLatestId] = useState<string>('')
const latestItem = useMemo(() => {
  const red = ROADMAP.find((i) => i.tone === 'red')
  return red || ROADMAP[0] || null
}, [])

// "Key" changes automatically if you change the latest item's text/date/title,
// so you don't *have* to remember to change the id every time.
const latestKey = useMemo(() => {
  if (!latestItem) return 'none'
  return `${latestItem.id}|${latestItem.date}|${latestItem.title}|${latestItem.text}|${latestItem.tone}`
}, [latestItem])


  useEffect(() => {
    setMounted(true)
    try {
      const v = localStorage.getItem(ROADMAP_SEEN_KEY) || ''
      setSeenLatestId(v)
    } catch {
      // ignore
    }
  }, [])

  const hasUnseen = latestKey !== 'none' && seenLatestId !== latestKey

  function markSeen() {
    try {
      localStorage.setItem(ROADMAP_SEEN_KEY, latestKey)
    } catch {
      // ignore
    }
    setSeenLatestId(latestKey)
  }

  function toggleOpen() {
    setOpen((v) => {
      const next = !v
      if (next) markSeen()
      return next
    })
  }

  const ui = (
    <>
      {/* Floating bell */}
      <motion.button
        type="button"
        onClick={toggleOpen}
        aria-label="Notifications"
        className={
          'fixed z-40 flex h-12 w-12 items-center justify-center rounded-2xl ' +
          'border border-white/60 bg-white/55 shadow-[0_18px_50px_rgba(0,0,0,0.18)] backdrop-blur-xl ' +
          'ring-1 ring-inset ring-zinc-900/5 transition active:scale-[0.98] ' +
          'dark:border-white/10 dark:bg-zinc-950/45 dark:ring-white/10'
        }
        style={{
          // Keep above iOS/Android safe areas + Farcaster bottom UI.
          bottom: 'calc(1.5rem + env(safe-area-inset-bottom))',
          right: 'calc(1.25rem + env(safe-area-inset-right))',
        }}
        animate={hasUnseen ? { rotate: [0, -8, 8, -6, 6, 0], y: [0, -1, 0] } : { rotate: 0, y: 0 }}
        transition={
          hasUnseen
            ? { duration: 1.0, repeat: Infinity, repeatDelay: 2.6, ease: 'easeInOut' }
            : { duration: 0.2 }
        }
      >
        <Bell className="h-5 w-5 text-zinc-900/90 dark:text-zinc-100" />

        {/* soft halo for unseen */}
        {hasUnseen ? (
          <motion.span
            aria-hidden
            className="absolute inset-[-10px] rounded-[22px]"
            initial={{ opacity: 0.0, scale: 0.95 }}
            animate={{ opacity: [0.0, 0.45, 0.0], scale: [0.95, 1.06, 0.95] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
            style={{ boxShadow: '0 0 0 10px rgba(244,63,94,0.08)' }}
          />
        ) : null}

        {/* status dot */}
        <span
          className={
            `absolute -right-1 -top-1 h-4 w-4 rounded-full ` +
            `border-2 border-white/90 shadow-sm dark:border-zinc-950/90 ` +
            (hasUnseen ? 'bg-rose-500' : 'bg-emerald-500')
          }
        />
      </motion.button>

      {/* Overlay */}
      <AnimatePresence>
        {open ? (
          <div className="fixed inset-0 z-[60]">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/35 backdrop-blur-[2px]"
              onClick={() => setOpen(false)}
            />

            {/*
              IMPORTANT (Farcaster / in-app webviews):
              Some hosts render the page inside a scaled/translated "layout viewport".
              Using `left: 50%` centering can look offset and push the panel off-screen.
              So we anchor using an inset flex wrapper + max width.
            */}
            <div
              className="absolute inset-0 flex items-end justify-end"
              style={{
                paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))',
                paddingRight: 'calc(1.25rem + env(safe-area-inset-right))',
                paddingLeft: 'calc(1.25rem + env(safe-area-inset-left))',
                paddingTop: 'calc(1.25rem + env(safe-area-inset-top))',
              }}
            >
              <motion.div
                initial={{ y: 24, opacity: 0, scale: 0.98 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                exit={{ y: 24, opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.2 }}
                className={
                  'w-full max-w-[26rem] overflow-hidden rounded-[28px] ' +
                  'border border-white/60 bg-white/55 shadow-[0_30px_90px_rgba(0,0,0,0.28)] ' +
                  'backdrop-blur-2xl ring-1 ring-inset ring-zinc-900/5 ' +
                  'dark:border-white/10 dark:bg-zinc-950/45 dark:ring-white/10'
                }
                style={{
                  maxHeight: 'calc(100vh - (1.25rem + env(safe-area-inset-top)) - (1.5rem + env(safe-area-inset-bottom)))',
                }}
                role="dialog"
                aria-modal="true"
              >
                {/* top gradient + handle */}
                <div className="relative px-5 pb-4 pt-4">
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/60 to-transparent dark:from-zinc-950/40" />
                  <div className="relative flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                        Updates
                      </div>
                      <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                        Roadmap & recent changes
                      </div>
                    </div>
                    <button
                      className="rounded-2xl p-2 text-zinc-700/80 hover:bg-white/50 dark:text-zinc-200/80 dark:hover:bg-white/10"
                      onClick={() => setOpen(false)}
                      aria-label="Close"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-3 flex justify-center">
                    <div className="h-1 w-10 rounded-full bg-zinc-900/10 dark:bg-white/10" />
                  </div>
                </div>

                <div className="relative px-5 pb-4">
                  {/* subtle timeline line */}
                  <div className="pointer-events-none absolute left-[18px] top-1 h-full w-px bg-gradient-to-b from-zinc-400/0 via-zinc-400/35 to-zinc-400/0 dark:via-zinc-500/30" />

                  {/* scroll area */}
                  <div
                    className="relative max-h-[60vh] space-y-4 overflow-auto pr-1 overscroll-contain touch-pan-y [-webkit-overflow-scrolling:touch]"
                    style={{ WebkitOverflowScrolling: 'touch' }}
                  >
                    {/* fade edges */}
                    <div className="pointer-events-none sticky top-0 z-10 -mt-2 h-6 bg-gradient-to-b from-white/70 to-transparent dark:from-zinc-950/55" />
                    {ROADMAP.map((item) => (
                      <ItemRow key={item.id} item={item} />
                    ))}
                    <div className="pointer-events-none sticky bottom-0 z-10 -mb-2 h-6 bg-gradient-to-t from-white/70 to-transparent dark:from-zinc-950/55" />
                  </div>
                </div>

                <div className="px-5 pb-5 text-[11px] text-zinc-500 dark:text-zinc-500">
                  Tip: Add new updates by editing <span className="font-mono">src/lib/roadmap.ts</span>
                </div>
              </motion.div>
            </div>
          </div>
        ) : null}
      </AnimatePresence>
    </>
  )

  if (mounted && typeof document !== 'undefined') {
    return createPortal(ui, document.body)
  }

  return ui
}