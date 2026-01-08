import OpenAI from "openai";
import { redis } from "./redis";
import type { SourcePost } from "./apify";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const USER_HISTORY_KEY = (userId: string) => `bp:history:${userId}`;

const BASE_FACTS = [
  "Base is an Ethereum Layer 2 built on the OP Stack and incubated by Coinbase.",
  "Base settles to Ethereum and is designed for fast, low-cost transactions.",
  "Avoid claiming specific launches, airdrops, prices, partnerships, or metrics unless explicitly provided in source posts.",
].join("\n");

const OPENERS_TO_AVOID = [
  "gm",
  "hot take",
  "unpopular opinion",
  "here’s the thing",
  "thread 🧵",
  "alpha",
  "just sayin",
  "I can’t believe",
];

const STYLE_SEEDS = [
  "one-liner, punchy",
  "clever analogy",
  "builder mindset",
  "meme-y but not cringe",
  "slightly contrarian then resolve",
  "short story vibe",
  "mini thesis in 2 sentences",
];

function pick<T>(arr: T[], n: number, seed: number): T[] {
  const a = [...arr];
  // simple seeded shuffle (LCG)
  let x = seed >>> 0;
  function rnd() {
    x = (1664525 * x + 1013904223) >>> 0;
    return x / 2 ** 32;
  }
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(n, a.length));
}

export async function generateBasePost(params: {
  userId: string;
  extra: string;
  posts: SourcePost[];
}): Promise<{ post: string; sourcesUsed: number }> {
  const now = Date.now();
  const seed = Number(BigInt.asUintN(32, BigInt(now) ^ BigInt(hash32(params.userId))));
  const chosen = pick(params.posts, 6, seed).filter((p) => p.text && p.text.length > 20);

  const style = pick(STYLE_SEEDS, 1, seed + 7)[0];

  const history = await redis.lrange(USER_HISTORY_KEY(params.userId), 0, 19);
  const recent = (history ?? []).filter(Boolean).join("\n- ");

  const sourcesBlock = chosen
    .map((p, i) => {
      const meta = [
        p.author ? `@${p.author}` : null,
        p.createdAt ? `${p.createdAt}` : null,
        p.likes != null ? `♥ ${p.likes}` : null,
        p.retweets != null ? `↻ ${p.retweets}` : null,
      ]
        .filter(Boolean)
        .join(" • ");
      return `SOURCE ${i + 1} (${meta || "no-meta"}):\n${p.text}`;
    })
    .join("\n\n");

  const system = `You write like a real crypto twitter user inside the Base ecosystem.
Rules:
- Output exactly ONE tweet-style post (no quotes, no markdown).
- Max 240 characters. Prefer 90-180.
- Must be Base-focused, but do NOT hallucinate facts. You may only state facts from BASE FACTS or directly implied by SOURCE posts.
- Do NOT copy-paste SOURCE text. Use it as inspiration only.
- Avoid cringe. Emojis are optional and tasteful (0-2).
- Avoid starting with these openers: ${OPENERS_TO_AVOID.join(", ")}.
- Avoid repeating phrases from the user's RECENT OUTPUTS.
- Keep it human, clever, natural.`;

  const user = `BASE FACTS:\n${BASE_FACTS}\n\nUSER EXTRA CONTEXT:\n${params.extra || "(none)"}\n\nSOURCE POSTS (inspiration):\n${sourcesBlock}\n\nRECENT OUTPUTS (avoid repetition):\n- ${recent || "(none)"}\n\nNow generate ONE unique Base banger.`;

  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    temperature: 0.95,
    max_tokens: 120,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const post = (completion.choices[0]?.message?.content ?? "").trim().replace(/^["“”]+|["“”]+$/g, "");
  if (!post) throw new Error("Empty model output");

  // Persist history (20 items)
  await redis.lpush(USER_HISTORY_KEY(params.userId), post);
  await redis.ltrim(USER_HISTORY_KEY(params.userId), 0, 19);

  return { post, sourcesUsed: chosen.length };
}

function hash32(s: string) {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
