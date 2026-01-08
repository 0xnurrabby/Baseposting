import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ensureUser } from "./_lib/credits";
import { getUserId, json, methodNotAllowed } from "./_lib/http";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return methodNotAllowed(res);

  const userId = getUserId(req);
  if (!userId) return json(res, 400, { ok: false, error: "Missing x-user-id" });

  try {
    const state = await ensureUser(userId);
    return json(res, 200, {
      ok: true,
      userId,
      credits: state.credits,
      lastShareUtcDate: state.lastShareUtcDate ?? null,
    });
  } catch {
    return json(res, 500, { ok: false, error: "Server error" });
  }
}
