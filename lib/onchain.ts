import { createPublicClient, http, parseAbiItem } from "viem";
import { base, baseSepolia } from "viem/chains";

export const USDC_BASE_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

function getChain(chainIdHex: string) {
  const id = (chainIdHex || "").toLowerCase();
  if (id === "0x14a34") return baseSepolia;
  return base;
}

export async function verifyUsdcTransfer(params: {
  txHash: `0x${string}`;
  expectedTo: `0x${string}`;
  minAmount: bigint;
  chainIdHex: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const chain = getChain(params.chainIdHex);
  const rpc = process.env.BASE_RPC_URL || chain.rpcUrls.default.http[0];
  const client = createPublicClient({ chain, transport: http(rpc) });

  const receipt = await client.getTransactionReceipt({ hash: params.txHash });
  if (receipt.status !== "success") return { ok: false, reason: "Transaction failed" };

  const expectedTo = params.expectedTo.toLowerCase();
  for (const log of receipt.logs) {
    try {
      const decoded = await client.decodeEventLog({
        abi: [TRANSFER_EVENT],
        data: log.data,
        topics: log.topics
      });
      const to = String((decoded.args as any).to).toLowerCase();
      const value = BigInt((decoded.args as any).value);
      if (to === expectedTo && value >= params.minAmount) return { ok: true };
    } catch {}
  }
  return { ok: false, reason: "No matching USDC Transfer log found" };
}
