import type { VercelRequest, VercelResponse } from "@vercel/node";
import { consumeCredit, setCredits } from "./_lib/credits";
import { fetchLatestPosts } from "./_lib/apify";
import { generateBasePost } from "./_lib/openai";
import { getUserId, json, methodNotAllowed, parseJsonBody } from "./_lib/http";
import { rateLimit } from "./_lib/ratelimit";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res);

  const userId = getUserId(req);
  if (!userId) return json(res, 400, { ok: false, error: "Missing x-user-id" });

  const rl = await rateLimit({ key: `${userId}:generate`, windowSeconds: 60, max: 8 });
  if (!rl.ok) return json(res, 429, { ok: false, error: `Rate limited. Try again in ${rl.retryAfterSeconds}s.` });

  const body = parseJsonBody(req);
  const extra = String(body?.extra ?? "").slice(0, 400);

  // 1 credit cost
  const spend = await consumeCredit(userId, 1);
  if (!spend.ok) return json(res, 402, { ok: false, error: "No credits left", credits: spend.credits });

  try {
    const posts = await fetchLatestPosts(Number(process.env.APIFY_LIMIT ?? 50));
    const { post, sourcesUsed } = await generateBasePost({ userId, extra, posts });
    return json(res, 200, { ok: true, userId, credits: spend.credits, post, sourcesUsed });
  } catch (e) {
    // refund credit on failure
    await setCredits(userId, spend.credits + 1);
    return json(res, 500, { ok: false, error: "Generation failed. Credit refunded.", credits: spend.credits + 1 });
  }
}
