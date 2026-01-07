const { q } = require("../../lib/db");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  let body;
  try {
    body = req.body && typeof req.body === "object" ? req.body : await readJson(req);
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  // Verify request signature using Farcaster helper (uses NEYNAR_API_KEY)
  let data;
  try {
    const { parseWebhookEvent, verifyAppKeyWithNeynar } = require("@farcaster/miniapp-node");
    data = await parseWebhookEvent(body, verifyAppKeyWithNeynar);
  } catch (e) {
    // Keep errors explicit for debugging; Base app requires successful webhook to activate token.
    return res.status(401).json({ success: false, error: e?.message || String(e) });
  }

  const fid = Number(data.fid);
  const appFid = Number(data.appFid);
  const event = data.event;

  try {
    // Event names follow frames v2 demo patterns (frame_added, frame_removed, notifications_enabled, notifications_disabled)
    switch (event.event) {
      case "frame_added":
      case "notifications_enabled": {
        if (event.notificationDetails?.token && event.notificationDetails?.url) {
          await q(
            `
            INSERT INTO notification_tokens (fid, app_fid, token, url, enabled, updated_at)
            VALUES ($1,$2,$3,$4,true,NOW())
            ON CONFLICT (fid, app_fid) DO UPDATE SET
              token=EXCLUDED.token,
              url=EXCLUDED.url,
              enabled=true,
              updated_at=NOW();
            `,
            [fid, appFid, String(event.notificationDetails.token), String(event.notificationDetails.url)]
          );
        }
        break;
      }
      case "frame_removed":
      case "notifications_disabled": {
        await q(
          `UPDATE notification_tokens SET enabled=false, updated_at=NOW() WHERE fid=$1 AND app_fid=$2;`,
          [fid, appFid]
        );
        break;
      }
      default:
        break;
    }

    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ success: false, error: e?.message || String(e) });
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
