import React, { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Bell, X } from 'lucide-react'

import { ROADMAP, ROADMAP_SEEN_KEY, getRoadmapLatestId, type RoadmapItem, type RoadmapTone } from '@/lib/roadmap'

function toneClasses(tone: RoadmapTone) {
  switch (tone) {
    case 'green':
      return {
        dot: 'bg-emerald-500',
        card: 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-900/40 dark:bg-emerald-950/30',
        badge: 'bg-emerald-600 text-white',
      }
    case 'red':
      return {
        dot: 'bg-rose-500',
        card: 'border-rose-200 bg-rose-50/80 dark:border-rose-900/40 dark:bg-rose-950/30',
        badge: 'bg-rose-600 text-white',
      }
    default:
      return {
        dot: 'bg-zinc-400',
        card: 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950',
        badge: 'bg-zinc-800 text-white dark:bg-white dark:text-zinc-900',
      }
  }
}

function ItemRow({ item }: { item: RoadmapItem }) {
  const c = toneClasses(item.tone)
  const isLatest = item.tone === 'red'

  return (
    <div className="relative flex gap-3">
      {/* timeline dot */}
      <div className="relative mt-1 flex w-8 justify-center">
        <div className={`h-3 w-3 rounded-full ${c.dot}`} />
      </div>

      <div className={`w-full rounded-2xl border p-4 ${c.card}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">{item.date}</div>
            <div className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{item.title}</div>
          </div>
          {isLatest ? (
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${c.badge}`}>Latest</span>
          ) : item.tone === 'green' ? (
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${c.badge}`}>Done</span>
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
  const latestId = useMemo(() => getRoadmapLatestId(), [])

  const [open, setOpen] = useState(false)
  const [seenLatestId, setSeenLatestId] = useState<string>('')

  useEffect(() => {
    try {
      const v = localStorage.getItem(ROADMAP_SEEN_KEY) || ''
      setSeenLatestId(v)
    } catch {
      // ignore
    }
  }, [])

  const hasUnseen = latestId !== 'none' && seenLatestId !== latestId

  function markSeen() {
    try {
      localStorage.setItem(ROADMAP_SEEN_KEY, latestId)
    } catch {
      // ignore
    }
    setSeenLatestId(latestId)
  }

  function toggleOpen() {
    setOpen((v) => {
      const next = !v
      if (next) markSeen()
      return next
    })
  }

  return (
    <>
      {/* Floating bell */}
      <motion.button
        type="button"
        onClick={toggleOpen}
        aria-label="Notifications"
        className="fixed bottom-6 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-2xl border border-zinc-200 bg-white/90 shadow-lg backdrop-blur transition active:scale-[0.98] dark:border-zinc-800 dark:bg-zinc-950/80"
        animate={
          hasUnseen
            ? {
                rotate: [0, -10, 10, -10, 10, 0],
              }
            : { rotate: 0 }
        }
        transition={
          hasUnseen
            ? {
                duration: 1.2,
                repeat: Infinity,
                repeatDelay: 2.2,
                ease: 'easeInOut',
              }
            : { duration: 0.2 }
        }
      >
        <Bell className="h-5 w-5 text-zinc-900 dark:text-zinc-100" />

        {/* status dot */}
        <span
          className={`absolute -right-1 -top-1 h-4 w-4 rounded-full border-2 border-white dark:border-zinc-950 ${
            hasUnseen ? 'bg-rose-500' : 'bg-emerald-500'
          }`}
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
              className="absolute inset-0 bg-black/40"
              onClick={() => setOpen(false)}
            />

            <motion.div
              initial={{ y: 24, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 24, opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="absolute bottom-6 left-1/2 w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 rounded-3xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
              role="dialog"
              aria-modal="true"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Updates</div>
                  <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Roadmap & recent changes</div>
                </div>
                <button
                  className="rounded-2xl p-2 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-5">
                <div className="relative">
                  {/* timeline line */}
                  <div className="absolute left-4 top-0 h-full w-px bg-zinc-200 dark:bg-zinc-800" />

                  <div className="max-h-[70vh] space-y-4 overflow-auto pr-1">
                    {ROADMAP.map((item) => (
                      <ItemRow key={item.id} item={item} />
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-4 text-xs text-zinc-500 dark:text-zinc-500">
                Tip: Add new updates by editing <span className="font-mono">src/lib/roadmap.ts</span>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </>
  )
}
