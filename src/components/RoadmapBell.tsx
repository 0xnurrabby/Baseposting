import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ROADMAP } from "../lib/roadmap";

type Tone = "red" | "green";
type RoadmapItem = {
  id: string;
  date: string;
  title: string;
  text: string;
  tone?: Tone;
};

const STORAGE_KEY = "bp_updates_seen_v2";

function safeGet(key: string) {
  try {
    return typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeSet(key: string, val: string) {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(key, val);
  } catch {
    // ignore
  }
}

function BellIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 22a2.2 2.2 0 0 0 2.2-2.2h-4.4A2.2 2.2 0 0 0 12 22Z"
        fill="currentColor"
        opacity="0.9"
      />
      <path
        d="M18 16.4V11a6 6 0 0 0-12 0v5.4L4.6 18a1 1 0 0 0 .8 1.6h13.2a1 1 0 0 0 .8-1.6L18 16.4Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function RoadmapBell() {
  const items = (ROADMAP as unknown as RoadmapItem[]) ?? [];

  // latest = array top item (tumi roadmap.ts e newest upore rakhle best)
  const latest = items[0];
  const latestSig = useMemo(() => {
    if (!latest) return "none";
    return `${latest.id}__${latest.date}__${latest.title}__${latest.text}__${latest.tone ?? ""}`;
  }, [latest]);

  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [hasUnseen, setHasUnseen] = useState(false);

  useEffect(() => {
    setMounted(true);
    const seen = safeGet(STORAGE_KEY);
    setHasUnseen(seen !== latestSig);
  }, [latestSig]);

  // body scroll lock when open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const markSeen = () => {
    safeSet(STORAGE_KEY, latestSig);
    setHasUnseen(false);
  };

  const toggleOpen = () => {
    setOpen((v) => {
      const next = !v;
      if (next) markSeen(); // open kore dekhlei seen
      return next;
    });
  };

  // position with safe-area (Farcaster webview friendly)
  const safeRight = "calc(14px + env(safe-area-inset-right))";
  const safeBottom = "calc(14px + env(safe-area-inset-bottom))";

  const bell = (
    <div
      style={{
        position: "fixed",
        right: safeRight,
        bottom: safeBottom,
        zIndex: 9999,
      }}
    >
      <motion.button
        type="button"
        onClick={toggleOpen}
        className="relative grid h-12 w-12 place-items-center rounded-2xl bg-white/90 shadow-lg ring-1 ring-black/5 backdrop-blur-md active:scale-[0.98]"
        aria-label="Updates"
        whileTap={{ scale: 0.98 }}
        animate={
          hasUnseen
            ? {
                rotate: [0, -6, 6, -4, 4, 0],
              }
            : { rotate: 0 }
        }
        transition={
          hasUnseen
            ? { duration: 0.9, repeat: Infinity, repeatDelay: 1.4, ease: "easeInOut" }
            : { duration: 0.2 }
        }
      >
        <span className="text-slate-800">
          <BellIcon />
        </span>

        {/* status dot (red = unseen, green = seen) */}
        <span
          className={[
            "absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full ring-2 ring-white",
            hasUnseen ? "bg-rose-500" : "bg-emerald-500",
          ].join(" ")}
        />

        {/* subtle halo (not annoying) */}
        {hasUnseen ? (
          <motion.span
            className="absolute inset-0 rounded-2xl ring-1 ring-rose-500/20"
            animate={{ opacity: [0.25, 0.5, 0.25] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          />
        ) : null}
      </motion.button>
    </div>
  );

  const overlay = (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="overlay"
          className="fixed inset-0 z-[10000]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* backdrop */}
          <button
            type="button"
            aria-label="Close updates"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/25"
          />

          {/* sheet wrapper (keeps inside viewport always) */}
          <div
            className="absolute inset-0 flex items-end justify-center"
            style={{
              paddingLeft: "12px",
              paddingRight: "12px",
              paddingBottom: "calc(12px + env(safe-area-inset-bottom))",
              paddingTop: "12px",
            }}
          >
            <motion.div
              className="w-full max-w-[520px] overflow-hidden rounded-3xl bg-white/92 shadow-2xl ring-1 ring-black/5 backdrop-blur-xl"
              initial={{ y: 24, scale: 0.985, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: 20, scale: 0.99, opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 26 }}
              role="dialog"
              aria-modal="true"
            >
              {/* header */}
              <div className="relative px-5 pt-4 pb-3">
                <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-black/10" />
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[15px] font-semibold text-slate-900">Updates</div>
                    <div className="text-[12.5px] text-slate-500">Roadmap & recent changes</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="grid h-9 w-9 place-items-center rounded-xl bg-black/5 text-slate-700 active:scale-[0.98]"
                    aria-label="Close"
                  >
                    <CloseIcon />
                  </button>
                </div>
              </div>

              {/* content */}
              <div className="px-4 pb-4">
                <div
                  className="relative max-h-[62vh] overflow-y-auto rounded-2xl bg-white/60 p-3 ring-1 ring-black/5"
                  style={{
                    WebkitOverflowScrolling: "touch",
                    overscrollBehavior: "contain",
                    touchAction: "pan-y",
                  }}
                >
                  {/* left subtle rail */}
                  <div className="absolute left-6 top-4 bottom-4 w-px bg-black/10" />

                  <div className="space-y-3">
                    {items.map((it, idx) => {
                      const tone: Tone = (it.tone ?? "green") as Tone;
                      const isLatest = idx === 0 && tone === "red";

                      // minimal professional colors
                      const cardBase =
                        "relative rounded-2xl px-4 py-3 shadow-sm ring-1 ring-black/5";
                      const cardTone =
                        tone === "red"
                          ? "bg-rose-50/90"
                          : "bg-emerald-50/80";

                      const badgeTone =
                        tone === "red"
                          ? "bg-rose-600 text-white"
                          : "bg-emerald-600 text-white";

                      return (
                        <div key={it.id} className="relative pl-10">
                          {/* arrow marker */}
                          <div className="absolute left-2 top-4 flex items-center gap-1">
                            <div
                              className={[
                                "grid h-7 w-7 place-items-center rounded-xl ring-1 ring-black/5",
                                tone === "red" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700",
                              ].join(" ")}
                            >
                              <ChevronIcon />
                            </div>
                          </div>

                          <div className={[cardBase, cardTone].join(" ")}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-[12px] font-medium text-slate-500">
                                  {it.date}
                                </div>
                                <div className="mt-0.5 text-[15px] font-semibold text-slate-900">
                                  {it.title}
                                </div>
                              </div>

                              <div
                                className={[
                                  "shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold shadow-sm",
                                  badgeTone,
                                ].join(" ")}
                              >
                                {isLatest ? "Latest" : "Done"}
                              </div>
                            </div>

                            <div className="mt-2 text-[13.5px] leading-relaxed text-slate-700">
                              {it.text}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-3 text-[12px] text-slate-400">
                  Tip: Add new updates by editing <span className="font-mono">src/lib/roadmap.ts</span>
                </div>
              </div>
            </motion.div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  if (!mounted || typeof document === "undefined") return null;

  return (
    <>
      {createPortal(bell, document.body)}
      {createPortal(overlay, document.body)}
    </>
  );
}
