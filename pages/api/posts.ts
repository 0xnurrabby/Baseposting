import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../lib/db";
import { requireUser } from "../../lib/auth";
import { isBaseRelevant } from "../../lib/text";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await requireUser(req);

    const baseOnly = String(req.query.baseOnly ?? "0") === "1";
    const includeReplies = String(req.query.includeReplies ?? "0") === "1";
    const q = String(req.query.q ?? "").trim().toLowerCase();

    const raw = await prisma.rawPost.findMany({
      orderBy: { timestamp: "desc" },
      take: 150, // pull more so we can filter in-memory while still prioritizing recency
      select: {
        tweetId: true,
        timestamp: true,
        handle: true,
        text: true,
        url: true,
        likes: true,
        reposts: true,
        replies: true,
        views: true,
        isReply: true,
        isRetweet: true,
      },
    });

    let filtered = raw;
    if (!includeReplies) {
      filtered = filtered.filter((p) => !p.isReply && !p.isRetweet);
    }
    if (q) {
      filtered = filtered.filter((p) => (p.text + " " + (p.url ?? "") + " @" + p.handle).toLowerCase().includes(q));
    }
    if (baseOnly) {
      filtered = filtered.filter((p) => isBaseRelevant(p.text));
    }

    // Final: latest 50 priority
    filtered = filtered.slice(0, 50);

    return res.status(200).json({ items: filtered });
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json({ error: e?.message ?? "error" });
  }
}
