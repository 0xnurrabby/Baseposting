const { q } = require("../../lib/db");
const {
  apifyUrl,
  pickTweetId,
  pickHandle,
  pickText,
  pickUrl,
  pickTimestamp,
  pickCounts,
  pickFlags,
} = require("../../lib/apify");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const token = process.env.APIFY_TOKEN;
  const datasetId = process.env.APIFY_DATASET_ID;
  if (!token || !datasetId) {
    return res.status(500).json({ error: "Missing APIFY_TOKEN or APIFY_DATASET_ID env var." });
  }

  const logs = [];
  const log = (line) => logs.push(line);

  try {
    log("fetching…");
    const url = apifyUrl({ datasetId, token, limit: 250 });
    const r = await fetch(url);
    if (!r.ok) {
      const t = await r.text();
      return res.status(500).json({ error: `Apify fetch failed: ${r.status} ${t}`, logs });
    }
    const items = await r.json();
    log(`fetched: ${Array.isArray(items) ? items.length : 0}`);

    log("upserting…");

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const it of items) {
      const tweetId = pickTweetId(it);
      const handle = pickHandle(it);
      const text = pickText(it);
      const url = pickUrl(it);
      const ts = pickTimestamp(it);
      const counts = pickCounts(it);
      const flags = pickFlags(it);

      if (!tweetId || !text || !ts) {
        skipped++;
        continue;
      }

      const raw = it;

      const result = await q(
        `
        INSERT INTO raw_posts (
          tweet_id, handle, text, url, timestamp,
          like_count, reply_count, retweet_count, quote_count,
          is_reply, is_retweet, raw, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,
          $6,$7,$8,$9,
          $10,$11,$12::jsonb, NOW()
        )
        ON CONFLICT (tweet_id) DO UPDATE SET
          handle = EXCLUDED.handle,
          text = EXCLUDED.text,
          url = EXCLUDED.url,
          timestamp = EXCLUDED.timestamp,
          like_count = EXCLUDED.like_count,
          reply_count = EXCLUDED.reply_count,
          retweet_count = EXCLUDED.retweet_count,
          quote_count = EXCLUDED.quote_count,
          is_reply = EXCLUDED.is_reply,
          is_retweet = EXCLUDED.is_retweet,
          raw = EXCLUDED.raw,
          updated_at = NOW()
        RETURNING (xmax = 0) AS inserted;
        `,
        [
          String(tweetId),
          String(handle).startsWith("@") ? String(handle) : "@" + String(handle),
          String(text),
          url ? String(url) : null,
          ts,
          counts.like,
          counts.reply,
          counts.retweet,
          counts.quote,
          flags.isReply,
          flags.isRetweet,
          JSON.stringify(raw),
        ]
      );

      if (result?.rows?.[0]?.inserted) inserted++;
      else updated++;
    }

    log(`done: inserted ${inserted}, updated ${updated}, skipped ${skipped}`);
    return res.status(200).json({ ok: true, inserted, updated, skipped, logs });
  } catch (e) {
    log("error: " + (e?.message || String(e)));
    return res.status(500).json({ error: e?.message || String(e), logs });
  }
}
