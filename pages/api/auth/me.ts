import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../lib/db";
import { requireUser } from "../../../lib/auth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { fid } = await requireUser(req);

    const userAgentInfo = req.headers["x-fc-user"] ? JSON.parse(String(req.headers["x-fc-user"])) : null;

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { fid } });
      if (!existing) {
        const created = await tx.user.create({
          data: {
            fid,
            username: userAgentInfo?.username ?? null,
            displayName: userAgentInfo?.displayName ?? null,
            pfpUrl: userAgentInfo?.pfpUrl ?? null,
            primaryWallet: userAgentInfo?.primaryWallet ?? null,
          },
        });
        await tx.creditTx.create({
          data: {
            fid,
            type: "FREE",
            delta: 10,
            meta: { reason: "new_user_free_credits" },
          },
        });
        const updated = await tx.user.update({
          where: { fid },
          data: { credits: 10, freeGranted: true },
        });
        return updated;
      }

      const updated = await tx.user.update({
        where: { fid },
        data: {
          username: userAgentInfo?.username ?? existing.username,
          displayName: userAgentInfo?.displayName ?? existing.displayName,
          pfpUrl: userAgentInfo?.pfpUrl ?? existing.pfpUrl,
          primaryWallet: userAgentInfo?.primaryWallet ?? existing.primaryWallet,
        },
      });

      // Backfill free credits if needed (safety)
      if (!updated.freeGranted) {
        await tx.creditTx.create({
          data: { fid, type: "FREE", delta: 10, meta: { reason: "backfill_free_credits" } },
        });
        return await tx.user.update({ where: { fid }, data: { credits: { increment: 10 }, freeGranted: true } });
      }
      return updated;
    });

    return res.status(200).json({
      fid: result.fid,
      username: result.username,
      displayName: result.displayName,
      pfpUrl: result.pfpUrl,
      primaryWallet: result.primaryWallet,
      credits: result.credits,
      lastShareAt: result.lastShareAt,
    });
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json({ error: e?.message ?? "error" });
  }
}
