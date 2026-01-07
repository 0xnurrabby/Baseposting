const { q } = require("../../../lib/db");

async function sendTo(details, payload) {
  const r = await fetch(details.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Some clients expect Bearer token, others expect token in body.
      "authorization": `Bearer ${details.token}`,
    },
    body: JSON.stringify({
      ...payload,
      token: details.token,
    }),
  });
  const text = await r.text();
  return { ok: r.ok, status: r.status, text };
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ error: "Use GET/POST" });

  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided = req.headers["x-cron-secret"] || req.query.key;
    if (String(provided || "") !== String(secret)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  try {
    const tokens = await q(
      `SELECT fid, app_fid, token, url FROM notification_tokens WHERE enabled=true;`
    );

    const now = new Date();
    const title = "Base Post Generator";
    const body = "Time to post — open the generator and ship something fresh.";
    const targetUrl = "https://baseposting.online/";

    let sent = 0;
    let failed = 0;

    for (const row of tokens.rows) {
      const details = { token: row.token, url: row.url };
      const out = await sendTo(details, {
        notificationId: `baseposting-${row.fid}-${now.getTime()}`,
        title,
        body,
        targetUrl,
      });
      if (out.ok) sent++;
      else failed++;
    }

    return res.status(200).json({ ok: true, sent, failed });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
