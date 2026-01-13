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

function getDarkNow() {
  try {
    const el = document.documentElement;
    const body = document.body;
    // class based
    if (el?.classList?.contains("dark") || body?.classList?.contains("dark")) return true;

    // attribute based
    const dt = el?.getAttribute?.("data-theme") || body?.getAttribute?.("data-theme");
    if (dt && dt.toLowerCase().includes("dark")) return true;

    // fallback
    return !!window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
  } catch {
    return false;
  }
}

function BellIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 22a2.2 2.2 0 0 0 2.2-2.2h-4.4A2.2 2.2 0 0 0 12 22Z" fill="currentColor" opacity="0.9" />
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
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RoadmapBell() {
  const items = (ROADMAP as unknown as RoadmapItem[]) ?? [];

  // newest item should be first
  const latest = items[0];
  const latestSig = useMemo(() => {
    if (!latest) return "none";
    return `${latest.id}__${latest.date}__${latest.title}__${latest.text}__${latest.tone ?? ""}`;
  }, [latest]);

  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [hasUnseen, setHasUnseen] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setMounted(true);
    setIsDark(getDarkNow());

    const seen = safeGet(STORAGE_KEY);
    setHasUnseen(seen !== latestSig);

    // system scheme changes
    let mq: MediaQueryList | null = null;
    const onMQ = () => setIsDark(getDarkNow());
    try {
      mq = window.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
      mq?.addEventListener?.("change", onMQ);
    } catch {
      // ignore
    }

    // class/data-theme changes (Farcaster toggle)
    const mo = new MutationObserver(() => setIsDark(getDarkNow()));
    try {
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
      mo.observe(document.body, { attributes: true, attributeFilter: ["class", "data-theme"] });
    } catch {
      // ignore
    }

    return () => {
      try {
        mq?.removeEventListener?.("change", onMQ);
      } catch {
        // ignore
      }
      try {
        mo.disconnect();
      } catch {
        // ignore
      }
    };
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
      if (next) markSeen();
      return next;
    });
  };

  // safe-area position
  const safeRight = "calc(14px + env(safe-area-inset-right))";
  const safeBottom = "calc(14px + env(safe-area-inset-bottom))";

  // Theme tokens
  const backdropBg = isDark ? "rgba(0,0,0,0.66)" : "rgba(0,0,0,0.36)";
  const panelBg = isDark ? "rgba(2, 6, 23, 0.92)" : "rgba(255,255,255,0.94)";
  const panelText = isDark ? "rgba(226,232,240,0.95)" : "rgba(15,23,42,0.95)";
  const subText = isDark ? "rgba(148,163,184,0.90)" : "rgba(100,116,139,0.85)";
  const ring = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
  const closeBg = isDark ? "rgba(255,255,255,0.10)" : "rgba(15,23,42,0.06)";
  const closeFg = isDark ? "rgba(255,255,255,0.92)" : "rgba(15,23,42,0.86)";

  // Blue rail colors
  const blueMid = isDark ? "rgba(147,197,253,0.55)" : "rgba(59,130,246,0.42)";
  const blueSoft = isDark ? "rgba(147,197,253,0.20)" : "rgba(59,130,246,0.16)";
  const blueFade = "rgba(59,130,246,0.00)";

  const bell = (
    <div style={{ position: "fixed", right: safeRight, bottom: safeBottom, zIndex: 9999 }}>
      <motion.button
        type="button"
        onClick={toggleOpen}
        aria-label="Updates"
        whileTap={{ scale: 0.98 }}
        className="relative grid h-12 w-12 place-items-center rounded-2xl shadow-lg backdrop-blur-md"
        style={{
          backgroundColor: isDark ? "rgba(2,6,23,0.86)" : "rgba(255,255,255,0.90)",
          border: `1px solid ${ring}`,
        }}
        animate={hasUnseen ? { rotate: [0, -6, 6, -4, 4, 0] } : { rotate: 0 }}
        transition={hasUnseen ? { duration: 0.9, repeat: Infinity, repeatDelay: 1.4, ease: "easeInOut" } : { duration: 0.2 }}
      >
        <span style={{ color: isDark ? "rgba(255,255,255,0.92)" : "rgba(15,23,42,0.90)" }}>
          <BellIcon />
        </span>

        {/* status dot */}
        <span
          className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full"
          style={{
            backgroundColor: hasUnseen ? "#F43F5E" : "#10B981",
            boxShadow: isDark ? "0 0 0 2px rgba(2,6,23,1)" : "0 0 0 2px rgba(255,255,255,1)",
          }}
        />

        {/* subtle halo */}
        {hasUnseen ? (
          <motion.span
            className="absolute inset-0 rounded-2xl"
            style={{ boxShadow: "0 0 0 1px rgba(244,63,94,0.18)" }}
            animate={{ opacity: [0.22, 0.45, 0.22] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          />
        ) : null}
      </motion.button>
    </div>
  );

  const overlay = (
    <AnimatePresence>
      {open ? (
        <motion.div key="overlay" className="fixed inset-0 z-[10000]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          {/* Backdrop */}
          <button type="button" aria-label="Close updates" onClick={() => setOpen(false)} className="absolute inset-0" style={{ backgroundColor: backdropBg }} />

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
              className="w-full max-w-[520px] overflow-hidden rounded-3xl shadow-2xl"
              style={{
                backgroundColor: panelBg,
                color: panelText,
                border: `1px solid ${ring}`,
                backdropFilter: "blur(14px)",
              }}
              initial={{ y: 26, scale: 0.985, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: 20, scale: 0.99, opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 26 }}
              role="dialog"
              aria-modal="true"
            >
              {/* Header */}
              <div className="relative px-5 pt-4 pb-3">
                <div className="mx-auto mb-2 h-1.5 w-10 rounded-full" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.10)" }} />
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[15px] font-semibold">Updates</div>
                    <div className="text-[12.5px]" style={{ color: subText }}>
                      Roadmap & recent changes
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close"
                    className="grid h-10 w-10 place-items-center rounded-2xl active:scale-[0.98]"
                    style={{
                      backgroundColor: closeBg,
                      color: closeFg,
                      border: `1px solid ${ring}`,
                    }}
                  >
                    <CloseIcon />
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="px-4 pb-4">
                <div
                  className="relative max-h-[62vh] overflow-y-auto rounded-2xl p-3"
                  style={{
                    backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.60)",
                    border: `1px solid ${ring}`,
                    WebkitOverflowScrolling: "touch",
                    overscrollBehavior: "contain",
                    touchAction: "pan-y",
                  }}
                >
                  {/* Timeline (L-branch arrows like your sketch) */}
                  {(() => {
                    // Layout constants (px)
                    const RAIL_LEFT = 22; // main vertical line x
                    const BRANCH_W = 26; // horizontal branch length
                    const ARROW_SIZE = 28; // arrow bubble size
                    const GAP_AFTER_ARROW = 14; // gap between arrow and card

                    // Derived positions
                    const ARROW_LEFT = RAIL_LEFT + BRANCH_W - ARROW_SIZE / 2; // arrow center on branch end
                    const ITEM_PL = ARROW_LEFT + ARROW_SIZE + GAP_AFTER_ARROW; // card left padding

                    return (
                      <>
                        {/* main vertical rail */}
                        <div
                          className="absolute top-4 bottom-4"
                          style={{
                            left: `${RAIL_LEFT}px`,
                            width: "2px",
                            borderRadius: "999px",
                            background: `linear-gradient(to bottom, ${blueFade}, ${blueMid}, ${blueFade})`,
                          }}
                        />

                        <div className="space-y-3">
                          {items.map((it, idx) => {
                            const tone: Tone = (it.tone ?? "green") as Tone;
                            const isLatest = idx === 0 && tone === "red";

                            const cardBg =
                              tone === "red"
                                ? isDark
                                  ? "rgba(244,63,94,0.14)"
                                  : "rgba(255,241,242,0.92)"
                                : isDark
                                  ? "rgba(16,185,129,0.14)"
                                  : "rgba(236,253,245,0.85)";

                            const badgeBg = tone === "red" ? "#F43F5E" : "#10B981";

                            const markerBg =
                              tone === "red"
                                ? isDark
                                  ? "rgba(244,63,94,0.22)"
                                  : "rgba(244,63,94,0.10)"
                                : isDark
                                  ? "rgba(16,185,129,0.22)"
                                  : "rgba(16,185,129,0.10)";

                            const markerFg = tone === "red" ? "#FB7185" : "#34D399";

                            return (
                              <div
                                key={it.id}
                                className="relative"
                                style={{
                                  paddingLeft: `${ITEM_PL}px`,
                                  minHeight: "92px",
                                }}
                              >
                                {/* horizontal branch from rail -> arrow */}
                                <div
                                  className="absolute"
                                  style={{
                                    left: `${RAIL_LEFT}px`,
                                    top: "28px",
                                    width: `${BRANCH_W}px`,
                                    height: "2px",
                                    background: `linear-gradient(to right, ${blueMid}, ${blueSoft})`,
                                    borderRadius: "999px",
                                    transform: "translateY(-1px)",
                                  }}
                                />

                                {/* arrow bubble at branch end */}
                                <div
                                  className="absolute grid place-items-center rounded-xl"
                                  style={{
                                    left: `${ARROW_LEFT}px`,
                                    top: "14px",
                                    width: `${ARROW_SIZE}px`,
                                    height: `${ARROW_SIZE}px`,
                                    backgroundColor: markerBg,
                                    color: markerFg,
                                    border: `1px solid ${ring}`,
                                    boxShadow: isDark ? "0 10px 18px rgba(0,0,0,0.35)" : "0 10px 18px rgba(0,0,0,0.10)",
                                  }}
                                >
                                  <ChevronIcon />
                                </div>

                                {/* card */}
                                <div className="relative rounded-2xl px-4 py-3 shadow-sm" style={{ backgroundColor: cardBg, border: `1px solid ${ring}` }}>
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="text-[12px] font-medium" style={{ color: subText }}>
                                        {it.date}
                                      </div>
                                      <div className="mt-0.5 text-[15px] font-semibold">{it.title}</div>
                                    </div>

                                    <div className="shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold shadow-sm" style={{ backgroundColor: badgeBg, color: "white" }}>
                                      {isLatest ? "Latest" : "Done"}
                                    </div>
                                  </div>

                                  <div className="mt-2 text-[13.5px] leading-relaxed" style={{ color: isDark ? "rgba(226,232,240,0.88)" : "rgba(51,65,85,0.95)" }}>
                                    {it.text}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    );
                  })()}
                </div>

                <div className="mt-3 text-[12px]" style={{ color: isDark ? "rgba(148,163,184,0.85)" : "rgba(100,116,139,0.75)" }}>
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
