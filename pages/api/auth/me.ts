// pages/api/me.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { requireMiniAppUserFromHeaders, AuthError } from "../../lib/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await requireMiniAppUserFromHeaders({
      authorization: req.headers.authorization
    });

    return res.status(200).json({ fid: user.fid });
  } catch (e: any) {
    if (e instanceof AuthError) {
      return res.status(e.status).json({ error: e.message });
    }
    return res.status(500).json({ error: "Server error" });
  }
}
