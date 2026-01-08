import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicClient, http, isHex } from "viem";
import { base } from "viem/chains";
import { awardCredits, isTxSeen, markTxSeen } from "./_lib/credits";
import { getUserId, json, methodNotAllowed, parseJsonBody } from "./_lib/http";
import { rateLimit } from "./_lib/ratelimit";

function isTxHash(v: string) {
  return v.startsWith("0x") && v.length === 66 && isHex(v);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res);

  const userId = getUserId(req);
  if (!userId) return json(res, 400, { ok: false, error: "Missing x-user-id" });

  const rl = await rateLimit({ key: `${userId}:verify`, windowSeconds: 60, max: 12 });
  if (!rl.ok) return json(res, 429, { ok: false, error: `Rate limited. Try again in ${rl.retryAfterSeconds}s.` });

  const body = parseJsonBody(req);
  const txHash = String(body?.txHash ?? "").trim();
  const contract = String(body?.contract ?? "").trim().toLowerCase();

  if (!txHash) return json(res, 400, { ok: false, error: "Missing txHash" });
  if (!contract || !contract.startsWith("0x") || contract.length !== 42) return json(res, 400, { ok: false, error: "Missing/invalid contract" });

  if (!isTxHash(txHash)) {
    // If wallet_sendCalls returned a callsId and we couldn't resolve, ask user to try again.
    return json(res, 400, { ok: false, error: "Still pending. Please wait a moment and try again." });
  }

  if (await isTxSeen(txHash)) {
    // Already counted globally; do not double award.
    return json(res, 200, { ok: true, credits: await awardCredits(userId, 0) });
  }

  const rpcUrl = process.env.BASE_RPC_URL;
  if (!rpcUrl) return json(res, 500, { ok: false, error: "Server missing BASE_RPC_URL env var" });

  try {
    const client = createPublicClient({
      chain: base,
      transport: http(rpcUrl),
    });

    const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });

    if (!receipt) return json(res, 400, { ok: false, error: "Receipt not found yet. Try again." });
    if (receipt.status !== "success") return json(res, 400, { ok: false, error: "Transaction failed" });

    // Verify destination contract
    const to = (receipt.to ?? "").toLowerCase();
    if (to !== contract) return json(res, 400, { ok: false, error: "Transaction was not sent to the credit contract" });

    // Mark globally seen
    await markTxSeen(txHash);

    const credits = await awardCredits(userId, 1);
    return json(res, 200, { ok: true, credits });
  } catch {
    return json(res, 500, { ok: false, error: "Could not verify tx. Try again." });
  }
}
