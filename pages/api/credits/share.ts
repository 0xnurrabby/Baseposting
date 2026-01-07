import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { prisma } from "../../../lib/db";
import { requireUser } from "../../../lib/auth";

const BodySchema = z.object({
  castHash: z.string().optional(),
});

function sameUtcDay(a: Date, b: Date) {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const { fid } = await requireUser(req);
    const body = BodySchema.parse(req.body);

    const now = new Date();

    const user = await prisma.user.findUnique({ where: { fid } });
    if (!user) return res.status(401).json({ error: "user_missing" });

    if (user.lastShareAt && sameUtcDay(user.lastShareAt, now)) {
      return res.status(200).json({ ok: true, alreadyClaimed: true, credits: user.credits });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.creditTx.create({
        data: {
          fid,
          type: "SHARE_DAILY",
          delta: 2,
          meta: { castHash: body.castHash ?? null },
        },
      });

      return await tx.user.update({
        where: { fid },
        data: { credits: { increment: 2 }, lastShareAt: now },
      });
    });

    return res.status(200).json({ ok: true, credits: updated.credits });
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json({ error: e?.message ?? "error" });
  }
}
