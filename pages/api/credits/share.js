const { q, withTx, qClient } = require("../../../lib/db");
const { requireFid } = require("../../../lib/auth");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const fid = await requireFid(req);
  if (!fid) return res.status(401).json({ error: "Not authenticated." });

  try {
    await q(`INSERT INTO user_credits (fid, credits) VALUES ($1, 10) ON CONFLICT (fid) DO NOTHING;`, [fid]);

    const today = new Date();
    const yyyy = today.getUTCFullYear();
    const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(today.getUTCDate()).padStart(2, "0");
    const isoDate = `${yyyy}-${mm}-${dd}`;

    const r = await q(`SELECT last_share_date FROM user_credits WHERE fid=$1;`, [fid]);
    const last = r.rows?.[0]?.last_share_date ? String(r.rows[0].last_share_date) : null;
    if (last === isoDate) {
      return res.status(409).json({ error: "Already shared today. Come back tomorrow." });
    }

    await withTx(async (client) => {
      await qClient(client, `UPDATE user_credits SET credits = credits + 2, last_share_date=$2, updated_at=NOW() WHERE fid=$1;`, [fid, isoDate]);
    });

    const cr = await q(`SELECT credits FROM user_credits WHERE fid=$1;`, [fid]);
    return res.status(200).json({ ok: true, credits: cr.rows?.[0]?.credits ?? null });
  } catch (e) {
    return res.status(e?.statusCode || 500).json({ error: e?.message || String(e) });
  }
}
