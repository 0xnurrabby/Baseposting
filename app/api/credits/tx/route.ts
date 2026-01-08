import { NextResponse } from "next/server";
import { z } from "zod";
import { publicClient, BASE_CHAIN_ID, CREDIT_CONTRACT } from "@/lib/base";
import { addCredits, markTxCounted, wasTxCounted } from "@/lib/credits";

const Body = z.object({
  userId: z.string().min(1),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

export async function POST(req: Request) {
  try {
    const { userId, txHash } = Body.parse(await req.json());

    if (await wasTxCounted(txHash)) {
      return NextResponse.json({ error: "Already counted" }, { status: 409 });
    }

    const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
    if (!receipt) return NextResponse.json({ error: "Receipt not found yet" }, { status: 404 });

    if (receipt.status !== "success") return NextResponse.json({ error: "Transaction failed" }, { status: 400 });

    // viem client is on Base mainnet; still confirm "to"
    const to = receipt.to?.toLowerCase();
    if (to !== CREDIT_CONTRACT.toLowerCase()) {
      return NextResponse.json({ error: "Tx not sent to credit contract" }, { status: 400 });
    }

    await markTxCounted(txHash);
    const credits = await addCredits(userId, 1);
    return NextResponse.json({ credits, chainId: BASE_CHAIN_ID });
  } catch (e: any) {
    // If tx isn't mined yet, viem throws.
    const msg = typeof e?.message === "string" ? e.message : "Bad request";
    if (msg.toLowerCase().includes("not found")) return NextResponse.json({ error: "Receipt not found yet" }, { status: 404 });
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
