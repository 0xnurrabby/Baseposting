export type ApifyPost = {
  author?: string;
  text?: string;
  createdAt?: string;
  likeCount?: number;
  replyCount?: number;
  retweetCount?: number;
  quoteCount?: number;
  url?: string;
};

type AnyObj = Record<string, any>;

function toNumber(x: any): number | undefined {
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
}

export async function fetchLatestPosts(limit = 50): Promise<ApifyPost[]> {
  const datasetId = process.env.APIFY_DATASET_ID;
  const token = process.env.APIFY_TOKEN;
  const itemsUrl = process.env.APIFY_DATASET_ITEMS_URL;

  if (!token) throw new Error("Missing APIFY_TOKEN");
  if (!datasetId && !itemsUrl) throw new Error("Missing APIFY_DATASET_ID or APIFY_DATASET_ITEMS_URL");

  const base = itemsUrl ? itemsUrl : `https://api.apify.com/v2/datasets/${datasetId}/items`;

  const url = new URL(base);
  if (!url.searchParams.has("clean")) url.searchParams.set("clean", "true");
  if (!url.searchParams.has("format")) url.searchParams.set("format", "json");
  url.searchParams.set("limit", String(limit));
  if (!url.searchParams.has("desc")) url.searchParams.set("desc", "true");
  if (!url.searchParams.has("token")) url.searchParams.set("token", token);

  const res = await fetch(url.toString(), { next: { revalidate: 0 } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Apify fetch failed (${res.status}): ${body.slice(0, 280)}`);
  }
  const data = (await res.json()) as AnyObj[];

  return (Array.isArray(data) ? data : []).slice(0, limit).map((it) => {
    const author = it.author?.name ?? it.user?.name ?? it.username ?? it.author ?? undefined;
    const text = it.text ?? it.fullText ?? it.tweetText ?? it.content ?? undefined;
    const createdAt = it.createdAt ?? it.date ?? it.time ?? it.timestamp ?? undefined;

    const likeCount = toNumber(it.likeCount ?? it.likes ?? it.favoriteCount);
    const replyCount = toNumber(it.replyCount ?? it.replies);
    const retweetCount = toNumber(it.retweetCount ?? it.retweets);
    const quoteCount = toNumber(it.quoteCount ?? it.quotes);
    const url2 = it.url ?? it.tweetUrl ?? undefined;

    return { author, text, createdAt, likeCount, replyCount, retweetCount, quoteCount, url: url2 };
  }).filter(p => (p.text ?? "").trim().length > 0);
}
