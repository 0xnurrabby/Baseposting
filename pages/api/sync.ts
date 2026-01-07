import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../lib/db";
import { requireUser } from "../../lib/auth";

type ApifyItem = Record<string, any>;

function asInt(n: any): number {
  const x = Number(n);
  return Number.isFinite(x) ? Math.max(0, Math.trunc(x)) : 0;
}

function pickTweetId(item: ApifyItem): string | null {
  return (
    item.tweet_id ??
    item.tweetId ??
    item.tweetID ??
    item.id ??
    item.statusId ??
    item.status_id ??
    null
  )?.toString?.() ?? null;
}

function pickHandle(item: ApifyItem): string {
  return (
    item.handle ??
    item.username ??
    item.userName ??
    item.author?.userName ??
    item.author?.username ??
    item.user?.screen_name ??
    item.user?.username ??
    "unknown"
  ).toString();
}

function pickText(item: ApifyItem): string {
  return (
    item.text ??
    item.fullText ??
    item.full_text ??
    item.tweetText ??
    item.content ??
    ""
  ).toString();
}

function pickUrl(item: ApifyItem, handle: string, tweetId: string): string | null {
  const direct =
    item.url ??
    item.tweetUrl ??
    item.tweet_url ??
    item.permalink ??
    item.link ??
    null;
  if (direct) return String(direct);
  if (handle && tweetId) return `https://x.com/${handle}/status/${tweetId}`;
  return null;
}

function pickTimestamp(item: ApifyItem): Date {
  const t =
    item.timestamp ??
    item.createdAt ??
    item.created_at ??
    item.date ??
    item.time ??
    item.publishedAt ??
    null;

  const d = t ? new Date(t) : null;
  if (d && !Number.isNaN(d.getTime())) return d;
  return new Date();
}

function pickFlags(item: ApifyItem): { isReply: boolean; isRetweet: boolean } {
  const type = String(item.type ?? item.tweetType ?? "").toLowerCase();
  const isReply = Boolean(item.isReply) || type === "reply";
  const isRetweet = Boolean(item.isRetweet) || Boolean(item.retweetedTweetId) || type === "retweet";
  return { isReply, isRetweet };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    await requireUser(req);

    const datasetId = process.env.APIFY_DATASET_ID;
    const token = process.env.APIFY_TOKEN;
    if (!datasetId || !token) return res.status(500).json({ error: "missing_APIFY_DATASET_ID_or_APIFY_TOKEN" });

    const url = `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&format=json&desc=1&limit=200&token=${token}`;
    const r = await fetch(url);
    if (!r.ok) {
      return res.status(500).json({ error: `apify_fetch_failed_${r.status}` });
    }
    const items: ApifyItem[] = await r.json();

    let inserted = 0;
    let updated = 0;

    for (const item of items) {
      const tweetId = pickTweetId(item);
      if (!tweetId) continue;
      const handle = pickHandle(item);
      const text = pickText(item);
      if (!text) continue;
      const url = pickUrl(item, handle, tweetId);
      const timestamp = pickTimestamp(item);
      const { isReply, isRetweet } = pickFlags(item);

      const likes = asInt(item.likeCount ?? item.likes);
      const reposts = asInt(item.retweetCount ?? item.reposts ?? item.retweet_count);
      const replies = asInt(item.replyCount ?? item.replies ?? item.reply_count);
      const views = asInt(item.viewCount ?? item.views ?? item.impressionCount ?? item.impressions);

      const exists = await prisma.rawPost.findUnique({ where: { tweetId }, select: { id: true } });
      if (!exists) inserted++;
      else updated++;

      await prisma.rawPost.upsert({
        where: { tweetId },
        update: {
          timestamp,
          handle,
          text,
          url,
          likes,
          reposts,
          replies,
          views,
          isReply,
          isRetweet,
          raw: item,
        },
        create: {
          tweetId,
          timestamp,
          handle,
          text,
          url,
          likes,
          reposts,
          replies,
          views,
          isReply,
          isRetweet,
          raw: item,
        },
      });
    }

    return res.status(200).json({
      ok: true,
      inserted,
      updated,
      fetched: items.length,
    });
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json({ error: e?.message ?? "error" });
  }
}
