import { NextResponse } from "next/server";
import { addCredits } from "@/lib/credits";
import { verifyUsdcTransfer } from "@/lib/onchain";

export const runtime = "nodejs";

function getUserId(req: Request): string {
  const userId = req.headers.get("x-user-id");
  if (!userId) throw new Error("Missing x-user-id");
  return userId;
}

export async function POST(req: Request) {
  try {
    const userId = getUserId(req);
    const body = await req.json().catch(() => ({}));
    const txHash = String(body?.txHash ?? "");
    const chainIdHex = String(body?.chainIdHex ?? "0x2105");
    if (!txHash.startsWith("0x") || txHash.length < 10) throw new Error("Invalid txHash");

    const treasury = (process.env.TREASURY_ADDRESS as `0x${string}` | undefined) ?? "0x0000000000000000000000000000000000000000";
    if (treasury.toLowerCase() === "0x0000000000000000000000000000000000000000") throw new Error("TREASURY_ADDRESS is not set");

    const min = BigInt(process.env.USDC_MIN_AMOUNT ?? "1000");

    const v = await verifyUsdcTransfer({
      txHash: txHash as `0x${string}`,
      expectedTo: treasury,
      minAmount: min,
      chainIdHex,
    });

    if (!v.ok) throw new Error(v.reason || "Verification failed");

    const credits = await addCredits(userId, 1);
    return NextResponse.json({ credits }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 400 });
  }
}
