import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchLatestPosts } from "./_lib/apify";
import { getUserId, json, methodNotAllowed } from "./_lib/http";
import { rateLimit } from "./_lib/ratelimit";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return methodNotAllowed(res);

  const userId = getUserId(req);
  if (!userId) return json(res, 400, { ok: false, error: "Missing x-user-id" });

  const rl = await rateLimit({ key: `${userId}:posts`, windowSeconds: 60, max: 10 });
  if (!rl.ok) return json(res, 429, { ok: false, error: `Rate limited. Try again in ${rl.retryAfterSeconds}s.` });

  try {
    const posts = await fetchLatestPosts(Number(process.env.APIFY_LIMIT ?? 50));
    return json(res, 200, { ok: true, count: posts.length, posts });
  } catch {
    return json(res, 500, { ok: false, error: "Could not fetch posts" });
  }
}
