export const OPENING_BANLIST = [
  "gm",
  "gm gm",
  "hot take",
  "unpopular opinion",
  "here's the thing",
  "quick thread",
  "thread:",
  "psa:",
  "breaking:",
  "let me be clear",
  "not financial advice",
];

export const STYLE_SEEDS = [
  "punchy one-liner + sly confidence",
  "witty contrast / before-after framing",
  "mini story: setup → twist → Base punchline",
  "dev energy: crisp, technical-but-human",
  "creator vibe: playful, relatable, slightly meme",
  "market vibe: calm conviction, no hype",
  "skeptical-to-bullish: flip the narrative",
  "callout: challenge the reader (friendly)",
];

export function pickStyleSeed(): string {
  const arr = new Uint32Array(1);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(arr);
  else arr[0] = Math.floor(Math.random() * 2 ** 32);
  return STYLE_SEEDS[arr[0] % STYLE_SEEDS.length]!;
}

export function normalizeStart(s: string): string {
  return s.trim().toLowerCase().replace(/^[“"']+|[”"']+$/g, "");
}

export function violatesOpeningBan(text: string): boolean {
  const start = normalizeStart(text).split("\n")[0] ?? "";
  for (const banned of OPENING_BANLIST) {
    if (start.startsWith(banned)) return true;
  }
  return false;
}

export function clampTweet(text: string, max = 280): string {
  const t = text.trim().replace(/\s+$/g, "");
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}
