import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import { prisma } from "../../../lib/db";

const APP_URL = "https://baseposting.online/";

type SendNotificationRequest = {
  notificationId: string;
  title: string;
  body: string;
  targetUrl: string;
  tokens: string[];
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

  const secret = process.env.CRON_SECRET;
  if (secret) {
    const got = req.headers.authorization;
    if (got !== `Bearer ${secret}`) return res.status(401).json({ error: "unauthorized" });
  }

  try {
    const subs = await prisma.notificationSub.findMany({
      where: { enabled: true },
      select: { fid: true, appFid: true, token: true, url: true },
      take: 2000,
    });

    const title = "Base Post Generator";
    const body = "New ideas waiting — generate a fresh post in 30 seconds.";

    // group by URL
    const byUrl = new Map<string, string[]>();
    for (const s of subs) {
      if (!byUrl.has(s.url)) byUrl.set(s.url, []);
      byUrl.get(s.url)!.push(s.token);
    }

    let sent = 0;
    let failed = 0;

    for (const [url, tokens] of byUrl.entries()) {
      const payload: SendNotificationRequest = {
        notificationId: crypto.randomUUID(),
        title,
        body,
        targetUrl: APP_URL,
        tokens,
      };

      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (r.ok) sent += tokens.length;
        else failed += tokens.length;
      } catch {
        failed += tokens.length;
      }
    }

    return res.status(200).json({ ok: true, recipients: subs.length, sent, failed });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "notify_error" });
  }
}
