import type { VercelRequest, VercelResponse } from "@vercel/node";
import { awardShareBonus } from "./_lib/credits";
import { getUserId, json, methodNotAllowed, parseJsonBody } from "./_lib/http";
import { rateLimit } from "./_lib/ratelimit";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res);

  const userId = getUserId(req);
  if (!userId) return json(res, 400, { ok: false, error: "Missing x-user-id" });

  const rl = await rateLimit({ key: `${userId}:share`, windowSeconds: 60, max: 6 });
  if (!rl.ok) return json(res, 429, { ok: false, error: `Rate limited. Try again in ${rl.retryAfterSeconds}s.` });

  const body = parseJsonBody(req);
  if (!body?.didShare) return json(res, 400, { ok: false, error: "Share not confirmed" });

  try {
    const out = await awardShareBonus(userId);
    if (!out.ok) return json(res, 400, { ok: false, error: out.error, credits: out.credits });
    return json(res, 200, out);
  } catch {
    return json(res, 500, { ok: false, error: "Server error" });
  }
}
