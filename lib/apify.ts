import { env } from "@/lib/env";
import { z } from "zod";
import { stripControlChars } from "@/lib/text";

export type SourcePost = {
  id: string;
  url?: string;
  author?: string;
  text: string;
  createdAt?: string;
  likes?: number;
  replies?: number;
  reposts?: number;
  quotes?: number;
};

const ApifyDatasetItem = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  url: z.string().optional(),
  text: z.string().optional(),
  fullText: z.string().optional(),
  createdAt: z.string().optional(),
  time: z.string().optional(),
  author: z
    .object({
      username: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
  user: z
    .object({
      screen_name: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
  likes: z.number().optional(),
  replies: z.number().optional(),
  retweets: z.number().optional(),
  reposts: z.number().optional(),
  quotes: z.number().optional(),
});

function guessActorInput() {
  // Works well with many "Twitter/X scraper" actors: provide a search query & limit.
  // You can tweak via env or by editing this function.
  const maxPosts = Number(env.APIFY_MAX_POSTS ?? "50");
  return {
    searchTerms: ["base", "Base App", "Base ecosystem", "on Base", "@base"],
    maxItems: maxPosts,
    maxTweets: maxPosts,
    includeReplies: false,
    includeRetweets: false,
    sort: "Latest",
    language: "en",
  };
}

export async function fetchLatestXPosts(): Promise<SourcePost[]> {
  const token = env.APIFY_TOKEN;
  const actorId = env.APIFY_ACTOR_ID;
  const input = guessActorInput();

  // Start actor run (wait for finish)
  const runRes = await fetch(`https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/runs?token=${token}&wait=60`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    // Avoid edge caching; we want fresh.
    cache: "no-store",
  });

  if (!runRes.ok) {
    const body = await runRes.text().catch(() => "");
    throw new Error(`Apify run failed: ${runRes.status} ${body}`);
  }

  const runJson = await runRes.json();
  const datasetId: string | undefined = runJson?.data?.defaultDatasetId;
  if (!datasetId) throw new Error("Apify run missing defaultDatasetId");

  // Read dataset items (max 50)
  const itemsRes = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&clean=true&format=json&limit=${encodeURIComponent(String(env.APIFY_MAX_POSTS))}`,
    { cache: "no-store" }
  );
  if (!itemsRes.ok) throw new Error(`Apify dataset fetch failed: ${itemsRes.status}`);

  const items = await itemsRes.json();
  if (!Array.isArray(items)) return [];

  const parsed: SourcePost[] = [];
  for (const raw of items) {
    const v = ApifyDatasetItem.safeParse(raw);
    if (!v.success) continue;
    const it = v.data;
    const text = stripControlChars(it.fullText ?? it.text ?? "");
    if (!text) continue;
    const author = it.author?.username ?? it.user?.screen_name ?? it.author?.name ?? it.user?.name;
    const createdAt = it.createdAt ?? it.time;
    parsed.push({
      id: String(it.id ?? crypto.randomUUID()),
      url: it.url,
      author,
      text,
      createdAt,
      likes: it.likes,
      replies: it.replies,
      reposts: it.reposts ?? it.retweets,
      quotes: it.quotes,
    });
  }

  return parsed.slice(0, Number(env.APIFY_MAX_POSTS));
}
