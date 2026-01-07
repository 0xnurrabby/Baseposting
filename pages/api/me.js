const { q } = require("../../lib/db");
const { requireFid } = require("../../lib/auth");

export default async function handler(req, res) {
  try {
    const fid = await requireFid(req);

    if (!fid) {
      return res.status(200).json({ ok: true, fid: null, credits: null });
    }

    await q(
      `INSERT INTO user_credits (fid, credits) VALUES ($1, 10)
       ON CONFLICT (fid) DO NOTHING;`,
      [fid]
    );

    const r = await q(`SELECT credits, last_share_date FROM user_credits WHERE fid=$1;`, [fid]);
    return res.status(200).json({
      ok: true,
      fid,
      credits: r.rows?.[0]?.credits ?? 0,
      lastShareDate: r.rows?.[0]?.last_share_date ?? null,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
