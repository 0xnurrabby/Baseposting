const { q } = require("../../lib/db");

const BASE_KEYWORDS = [
  "base",
  "baseapp",
  "buildonbase",
  "onchain",
  "basenames",
  "onchainkit",
  "coinbase",
  "l2",
];

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Use GET" });

  const limit = Math.max(1, Math.min(50, Number(req.query.limit || 50) || 50));
  const baseOnly = String(req.query.baseOnly || "false") === "true";
  const includeRR = String(req.query.includeRR || "false") === "true";
  const search = String(req.query.search || "").trim();

  try {
    const where = [];
    const params = [];
    let i = 1;

    if (!includeRR) {
      where.push("(is_reply = false AND is_retweet = false)");
    }

    if (baseOnly) {
      const ors = [];
      for (const kw of BASE_KEYWORDS) {
        ors.push(`LOWER(text) LIKE $${i++}`);
        params.push(`%${kw}%`);
      }
      where.push("(" + ors.join(" OR ") + ")");
    }

    if (search) {
      where.push(`(LOWER(text) LIKE $${i} OR LOWER(handle) LIKE $${i})`);
      params.push(`%${search.toLowerCase()}%`);
      i++;
    }

    const sql = `
      SELECT tweet_id, handle, text, url, timestamp,
        like_count, reply_count, retweet_count, quote_count,
        is_reply, is_retweet
      FROM raw_posts
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY timestamp DESC
      LIMIT ${limit};
    `;

    const r = await q(sql, params);
    return res.status(200).json({ ok: true, items: r.rows });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
