import React, { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Bell, ChevronRight, X } from 'lucide-react'
import { createPortal } from 'react-dom'

import { ROADMAP, ROADMAP_SEEN_KEY, type RoadmapItem, type RoadmapTone } from '@/lib/roadmap'

function toneClasses(tone: RoadmapTone) {
  // Keep color usage subtle: accent + badges only.
  switch (tone) {
    case 'green':
      return {
        accent: 'bg-emerald-500',
        arrowBg: 'bg-emerald-500/10',
        arrowIcon: 'text-emerald-700 dark:text-emerald-300',
        badge:
          'bg-emerald-600/10 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:text-emerald-200',
        card:
          'border-zinc-200/60 bg-white/65 ring-1 ring-inset ring-white/40 ' +
          'dark:border-white/10 dark:bg-zinc-950/35 dark:ring-white/5',
      }
    case 'red':
    default:
      return {
        accent: 'bg-rose-500',
        arrowBg: 'bg-rose-500/10',
        arrowIcon: 'text-rose-700 dark:text-rose-300',
        badge:
          'bg-rose-600/10 text-rose-700 ring-1 ring-inset ring-rose-600/20 dark:text-rose-200',
        card:
          'border-zinc-200/60 bg-white/65 ring-1 ring-inset ring-white/40 ' +
          'dark:border-white/10 dark:bg-zinc-950/35 dark:ring-white/5',
      }
  }
}

function ItemRow({ item }: { item: RoadmapItem }) {
  const c = toneClasses(item.tone)
  const isLatest = item.tone === 'red'

  return (
    <div className="relative flex gap-3">
      {/* minimal rail + arrow (no colorful dots) */}
      <div className="relative w-8 shrink-0">
        <div className="absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 bg-zinc-200/70 dark:bg-zinc-800/60" />
        <div className="relative mt-4 flex justify-center">
          <div
            className={
              `flex h-7 w-7 items-center justify-center rounded-2xl ${c.arrowBg} ` +
              `ring-1 ring-inset ring-white/50 shadow-sm dark:ring-white/5`
            }
          >
            <ChevronRight className={`h-4 w-4 ${c.arrowIcon}`} strokeWidth={2.5} />
          </div>
        </div>
      </div>

      <div
        className={
          `relative w-full rounded-3xl border p-4 pl-5 shadow-[0_10px_28px_rgba(0,0,0,0.06)] ` +
          `backdrop-blur-xl ${c.card}`
        }
      >
        {/* subtle accent */}
        <div className={`absolute left-3 top-5 h-10 w-[3px] rounded-full ${c.accent} opacity-25`} />

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
            <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold ${c.badge}`}>
              Latest
            </span>
          ) : item.tone === 'green' ? (
            <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold ${c.badge}`}>
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
{/* scroll area */}
                  <div
                    className="relative max-h-[62vh] space-y-4 overflow-y-auto pr-1 pt-2 pb-3 overscroll-contain touch-pan-y [-webkit-overflow-scrolling:touch]"
                    style={{ WebkitOverflowScrolling: 'touch' }}
                  >
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