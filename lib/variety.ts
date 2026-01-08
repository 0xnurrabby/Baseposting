import { createHash } from "crypto";

const OPENERS = [
  "GM",
  "Hot take",
  "Here’s the thing",
  "If you’re building",
  "Real talk",
  "Lowkey",
  "PSA",
  "Reminder",
  "Wild",
  "Not financial advice but",
];

const STYLES = [
  "ultra concise, one-liner punch",
  "curious builder vibe",
  "meme-ish but not cringe",
  "clean alpha drop",
  "optimistic futurist",
  "skeptical-but-bullish",
  "community first",
  "shipping energy",
  "product-oriented",
];

export function makeSeed(userId: string, now = Date.now()) {
  const h = createHash("sha256").update(`${userId}:${now}:${Math.random()}`).digest("hex");
  return h.slice(0, 16);
}

export function pickStyle(seedHex: string) {
  const n = parseInt(seedHex.slice(0, 8), 16);
  return STYLES[n % STYLES.length];
}

export function pickAvoidedOpeners(seedHex: string) {
  const n = parseInt(seedHex.slice(8, 16), 16);
  // avoid 3 openers deterministically
  const avoided = new Set<string>();
  for (let i = 0; i < 3; i++) avoided.add(OPENERS[(n + i * 7) % OPENERS.length]);
  return Array.from(avoided);
}

export const REPETITION_GUARDS = {
  bannedPhrases: [
    "we are so early",
    "based",
    "ngmi",
    "wagmi",
    "to the moon",
    "ser",
    "fren",
  ],
  bannedPatterns: [
    /^gm\b/i,
    /^hot take\b/i,
    /^psa\b/i,
    /^here's the thing\b/i,
  ],
};
