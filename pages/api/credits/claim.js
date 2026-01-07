const { q, withTx, qClient } = require("../../../lib/db");
const { requireFid } = require("../../../lib/auth");

const CREDIT_CONTRACT = "0xB331328F506f2D35125e367A190e914B1b6830cF";

async function rpc(method, params) {
  const url = process.env.BASE_RPC_URL || "https://mainnet.base.org";
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  if (!r.ok) throw new Error(`RPC error ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "RPC error");
  return j.result;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const fid = await requireFid(req);
  if (!fid) return res.status(401).json({ error: "Not authenticated." });

  const txHash = String(req.body?.txHash || "").trim();
  if (!/^0x([A-Fa-f0-9]{64})$/.test(txHash)) return res.status(400).json({ error: "Invalid txHash" });

  try {
    await q(`INSERT INTO user_credits (fid, credits) VALUES ($1, 10) ON CONFLICT (fid) DO NOTHING;`, [fid]);

    const already = await q(`SELECT 1 FROM credit_claims WHERE tx_hash=$1;`, [txHash]);
    if (already.rowCount) return res.status(409).json({ error: "This tx was already used." });

    const tx = await rpc("eth_getTransactionByHash", [txHash]);
    const receipt = await rpc("eth_getTransactionReceipt", [txHash]);

    if (!tx || !receipt) return res.status(404).json({ error: "Transaction not found yet. Try again." });
    if ((receipt.status || "").toLowerCase() !== "0x1") return res.status(400).json({ error: "Transaction failed." });

    const to = (tx.to || "").toLowerCase();
    if (to !== CREDIT_CONTRACT.toLowerCase()) {
      return res.status(400).json({ error: "Tx not sent to the credit contract." });
    }

    const from = (tx.from || "").toLowerCase();

await withTx(async (client) => {
  const exists = await qClient(client, `SELECT 1 FROM credit_claims WHERE tx_hash=$1 FOR UPDATE;`, [txHash]);
  if (exists.rowCount) {
    const err = new Error("This tx was already used.");
    err.statusCode = 409;
    throw err;
  }
  await qClient(client, `UPDATE user_credits SET credits = credits + 1, updated_at = NOW() WHERE fid=$1;`, [fid]);
  await qClient(client, `INSERT INTO credit_claims (tx_hash, fid, from_address, chain_id) VALUES ($1,$2,$3,$4);`, [
    txHash,
    fid,
    from,
    "0x2105"
  ]);
});

    const cr = await q(`SELECT credits FROM user_credits WHERE fid=$1;`, [fid]);
    return res.status(200).json({ ok: true, credits: cr.rows?.[0]?.credits ?? null });
  } catch (e) {
    try { await q("ROLLBACK"); } catch {}
    return res.status(e?.statusCode || 500).json({ error: e?.message || String(e) });
  }
}
