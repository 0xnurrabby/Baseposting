import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { prisma } from "../../../lib/db";
import { requireUser } from "../../../lib/auth";
import { createPublicClient, http, isAddress, getAddress } from "viem";
import { base } from "viem/chains";

const BodySchema = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  wallet: z.string().optional(),
});

const CREDIT_CONTRACT = "0xB331328F506f2D35125e367A190e914B1b6830cF";
const ACTION_SELECTOR = "0x2d9bc1fb"; // logAction(bytes32,bytes) per BaseScan tx decode

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const { fid } = await requireUser(req);
    const body = BodySchema.parse(req.body);

    const wallet = body.wallet && isAddress(body.wallet) ? getAddress(body.wallet) : undefined;

    // prevent replay
    const existing = await prisma.creditTx.findFirst({ where: { txHash: body.txHash } });
    if (existing) return res.status(200).json({ ok: true, alreadyCounted: true });

    const rpcUrl = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
    const client = createPublicClient({ chain: base, transport: http(rpcUrl) });

    const [tx, receipt] = await Promise.all([
      client.getTransaction({ hash: body.txHash as `0x${string}` }),
      client.getTransactionReceipt({ hash: body.txHash as `0x${string}` }),
    ]);

    if (!receipt || receipt.status !== "success") {
      return res.status(400).json({ error: "tx_not_success" });
    }

    if (!tx.to || getAddress(tx.to) !== getAddress(CREDIT_CONTRACT)) {
      return res.status(400).json({ error: "tx_wrong_contract" });
    }

    if (!tx.input || !tx.input.startsWith(ACTION_SELECTOR)) {
      return res.status(400).json({ error: "tx_wrong_method" });
    }

    if (wallet) {
      if (getAddress(tx.from) !== wallet) return res.status(400).json({ error: "tx_from_mismatch" });
    }

    const updated = await prisma.$transaction(async (txdb) => {
      if (wallet) {
        await txdb.user.upsert({
          where: { fid },
          update: { primaryWallet: wallet },
          create: { fid, primaryWallet: wallet, credits: 0, freeGranted: false },
        });
      }

      await txdb.creditTx.create({
        data: {
          fid,
          type: "EARN_CONTRACT",
          delta: 1,
          txHash: body.txHash,
          meta: {
            contract: CREDIT_CONTRACT,
            methodSelector: ACTION_SELECTOR,
          },
        },
      });

      return await txdb.user.update({ where: { fid }, data: { credits: { increment: 1 } } });
    });

    return res.status(200).json({ ok: true, credits: updated.credits });
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json({ error: e?.message ?? "error" });
  }
}
