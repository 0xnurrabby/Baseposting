import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../lib/db";
import { parseWebhookEvent, verifyAppKeyWithNeynar } from "@farcaster/miniapp-node";

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const requestJson = req.body;

    if (!process.env.NEYNAR_API_KEY) {
      // Base App may require verification to activate tokens reliably.
      // Fail loudly so it gets configured correctly.
      return res.status(500).json({ error: "missing_NEYNAR_API_KEY" });
    }

    const data = await parseWebhookEvent(requestJson, verifyAppKeyWithNeynar);

    const fid = data.fid;
    const appFid = data.appFid;
    const event = data.event;

    // Always use (fid, appFid) pair per docs
    if (event.event === "miniapp_removed" || event.event === "notifications_disabled") {
      await prisma.notificationSub.updateMany({
        where: { fid, appFid },
        data: { enabled: false },
      });
      return res.status(200).json({ ok: true });
    }

    if ((event.event === "miniapp_added" || event.event === "notifications_enabled") && event.notificationDetails) {
      await prisma.notificationSub.upsert({
        where: { fid_appFid: { fid, appFid } },
        update: {
          token: event.notificationDetails.token,
          url: event.notificationDetails.url,
          enabled: true,
        },
        create: {
          fid,
          appFid,
          token: event.notificationDetails.token,
          url: event.notificationDetails.url,
          enabled: true,
        },
      });
      // Ensure user exists (no credit changes here)
      await prisma.user.upsert({
        where: { fid },
        update: {},
        create: { fid, credits: 0, freeGranted: false },
      });

      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true, ignored: true });
  } catch (e: any) {
    // Return 400/401 for verification issues when possible; keep generic here.
    return res.status(400).json({ error: e?.message ?? "webhook_error" });
  }
}
