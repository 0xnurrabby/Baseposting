export function normalizeText(s: string): string {
  return s
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[@#][\w_]+/g, " ")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function sha256Hex(input: string): string {
  // Browser-safe fallback; server will override if needed
  // NOTE: In Node we use crypto in the API layer.
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return "h" + h.toString(16).padStart(8, "0");
}

export function has7WordOverlap(input: string, output: string): boolean {
  const inWords = normalizeText(input).split(" ").filter(Boolean);
  const outNorm = " " + normalizeText(output) + " ";
  if (inWords.length < 7) return false;
  const seen = new Set<string>();
  for (let i = 0; i <= inWords.length - 7; i++) {
    const phrase = inWords.slice(i, i + 7).join(" ");
    if (seen.has(phrase)) continue;
    seen.add(phrase);
    if (outNorm.includes(" " + phrase + " ")) return true;
  }
  return false;
}

export function diceSimilarity(a: string, b: string): number {
  const A = bigrams(normalizeText(a));
  const B = bigrams(normalizeText(b));
  if (A.size === 0 && B.size === 0) return 1;
  const inter = [...A].filter((x) => B.has(x)).length;
  return (2 * inter) / (A.size + B.size);
}

function bigrams(s: string): Set<string> {
  const w = s.split(" ").filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i < w.length - 1; i++) out.add(w[i] + " " + w[i + 1]);
  return out;
}

export type Category = "INFO" | "OPINION" | "MEME";

const INFO_WORDS = [
  "released",
  "launched",
  "announced",
  "mainnet",
  "update",
  "version",
  "integration",
  "proposal",
  "docs",
  "guide",
  "audit",
  "status",
  "incident",
];

export function classify(text: string, url?: string | null): Category {
  const t = text.toLowerCase();
  const hasUrl = Boolean(url) || /https?:\/\//i.test(text);
  const hasInfoWord = INFO_WORDS.some((w) => t.includes(w));
  const hasNumbersOrDates = /\b\d{1,4}([\/-]\d{1,2}([\/-]\d{1,4})?)?\b/.test(text);
  if (hasUrl || hasInfoWord || hasNumbersOrDates) return "INFO";

  // meme heuristics
  const meme =
    /\b(gm|gn|ngmi|wagmi|wen|ser|anon|lol|lmao|bruh)\b/i.test(text) ||
    /😂|🤣|😭|😅|🫡|💀|🧠|🔥|🚀|🫨|🫠/.test(text) ||
    text.length < 70;
  return meme ? "MEME" : "OPINION";
}

export function confidence(text: string, url?: string | null): "HIGH" | "LOW" {
  const t = text.toLowerCase();
  const hasUrl = Boolean(url) || /https?:\/\//i.test(text);
  const hasUpdateWords =
    /(released|launched|announced|version|v\d|status|docs|guide|audit|incident|integrat|proposal|changelog)/i.test(text);
  const hasNumbersOrDates = /\b\d{1,4}([\/-]\d{1,2}([\/-]\d{1,4})?)?\b/.test(text);
  return hasUrl || hasUpdateWords || hasNumbersOrDates ? "HIGH" : "LOW";
}

export const BASE_KEYWORDS = [
  "base",
  "baseapp",
  "buildonbase",
  "onchain",
  "basenames",
  "onchainkit",
  "coinbase",
  "l2",
];

export function isBaseRelevant(text: string): boolean {
  const t = text.toLowerCase();
  return BASE_KEYWORDS.some((k) => t.includes(k));
}
