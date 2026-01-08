import { ApifyClient } from "apify-client";
import { redis } from "./redis";
import { z } from "zod";

export type SourcePost = {
  id?: string;
  author?: string;
  text: string;
  createdAt?: string;
  url?: string;
  likes?: number;
  replies?: number;
  retweets?: number;
  quotes?: number;
};

const CACHE_KEY = "bp:apify:posts:v1";

const ApifyItem = z.object({
  id: z.string().optional(),
  author: z.any().optional(),
  user: z.any().optional(),
  text: z.string().optional(),
  fullText: z.string().optional(),
  createdAt: z.string().optional(),
  timestamp: z.string().optional(),
  url: z.string().optional(),
  likes: z.number().optional(),
  replies: z.number().optional(),
  retweets: z.number().optional(),
  quotes: z.number().optional(),
}).passthrough();

function normalizeAuthor(item: any) {
  const a = item.author ?? item.user;
  if (!a) return undefined;
  return a.username ?? a.handle ?? a.name ?? undefined;
}

function normalizeItem(raw: any): SourcePost | null {
  const parsed = ApifyItem.safeParse(raw);
  if (!parsed.success) return null;
  const item = parsed.data as any;
  const text = (item.fullText ?? item.text ?? "").trim();
  if (!text) return null;
  return {
    id: item.id,
    author: normalizeAuthor(item),
    text,
    createdAt: item.createdAt ?? item.timestamp,
    url: item.url,
    likes: item.likes,
    replies: item.replies,
    retweets: item.retweets,
    quotes: item.quotes,
  };
}

export async function fetchLatestPosts(limit = 50): Promise<SourcePost[]> {
  // 1) Cache (short TTL)
  const cached = await redis.get<string>(CACHE_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as SourcePost[];
      if (Array.isArray(parsed) && parsed.length) return parsed.slice(0, limit);
    } catch {
      // ignore
    }
  }

  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("Missing APIFY_TOKEN");

  const client = new ApifyClient({ token });

  // Prefer dataset if provided (cheapest + fastest)
  const datasetId = process.env.APIFY_DATASET_ID;
  if (datasetId) {
    const list = await client.dataset(datasetId).listItems({ limit });
    const items = (list.items ?? []).map(normalizeItem).filter(Boolean) as SourcePost[];
    await redis.set(CACHE_KEY, JSON.stringify(items), { ex: 120 });
    return items;
  }

  const actorId = process.env.APIFY_ACTOR_ID;
  if (!actorId) throw new Error("Missing APIFY_DATASET_ID or APIFY_ACTOR_ID");

  // Actor input is user-configured to match their preferred scraper.
  // This avoids us guessing a specific actor schema.
  const rawInput = process.env.APIFY_ACTOR_INPUT_JSON ?? "{}";
  let input: any = {};
  try {
    input = JSON.parse(rawInput);
  } catch {
    input = {};
  }

  // Run actor, then read its default dataset.
  const run = await client.actor(actorId).call(input);
  const list = await client.dataset(run.defaultDatasetId).listItems({ limit });
  const items = (list.items ?? []).map(normalizeItem).filter(Boolean) as SourcePost[];
  await redis.set(CACHE_KEY, JSON.stringify(items), { ex: 120 });
  return items;
}
