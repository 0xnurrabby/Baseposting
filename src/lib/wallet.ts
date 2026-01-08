import { sdk } from "@farcaster/miniapp-sdk";
import { getDataSuffix, canSendWithAttribution, RECIPIENT } from "./attribution";

export type WalletInfo = { address?: string };

function isUserRejected(err: unknown) {
  const msg = typeof err === "object" && err && "message" in err ? String((err as any).message) : String(err);
  return /user rejected|rejected the request|denied|cancel/i.test(msg);
}

export async function getEthereumProvider() {
  return sdk.wallet.getEthereumProvider();
}

export async function getWalletInfo(): Promise<WalletInfo> {
  try {
    const provider = await getEthereumProvider();
    const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
    return { address: accounts?.[0] };
  } catch {
    return {};
  }
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function resolveTxHashFromCallsId(provider: any, callsId: string): Promise<string | null> {
  // EIP-5792: Poll wallet_getCallsStatus for up to ~20s.
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    try {
      const status = await provider.request({
        method: "wallet_getCallsStatus",
        params: [callsId],
      });

      const receipts = status?.receipts ?? status?.result?.receipts;
      const txHash = receipts?.[0]?.transactionHash ?? receipts?.[0]?.txHash;
      const state = status?.status ?? status?.result?.status;

      if (txHash && typeof txHash === "string" && txHash.startsWith("0x") && txHash.length === 66) return txHash;
      if (state && typeof state === "string" && /FAILED|CANCELLED/i.test(state)) return null;
    } catch {
      // ignore and retry
    }
    await sleep(750);
  }
  return null;
}

/**
 * "Get Credit" button: execute a tx on Base to the given contract.
 * We attempt EIP-5792 wallet_sendCalls (better UX) with Base Builder attribution.
 * If the wallet returns only a callsId, we poll wallet_getCallsStatus to extract the txHash.
 * If EIP-5792 isn't supported, fallback to eth_sendTransaction.
 */
export async function sendCreditTx(params: { to: `0x${string}`; valueWei?: `0x${string}` }) {
  const provider = await getEthereumProvider();
  const { ok, reason } = canSendWithAttribution();
  const dataSuffix = getDataSuffix();

  // Always keep UI usable if attribution params are not configured.
  if (!ok) {
    return { ok: false as const, error: reason ?? "Attribution not configured" };
  }

  const chainIdHex = "0x2105"; // 8453 (Base)

  // Preferred: wallet_sendCalls
  try {
    const callsId = (await provider.request({
      method: "wallet_sendCalls",
      params: [
        {
          chainId: chainIdHex,
          calls: [
            {
              to: params.to,
              value: params.valueWei ?? "0x0",
              data: "0x",
            },
          ],
          capabilities: dataSuffix ? { dataSuffix } : undefined,
        },
      ],
    })) as string;

    if (callsId && typeof callsId === "string") {
      const txHash = await resolveTxHashFromCallsId(provider, callsId);
      if (txHash) return { ok: true as const, txHash };
      // If we can't resolve, return the callsId and let backend handle "pending" gracefully.
      return { ok: true as const, txHash: callsId };
    }
  } catch (err) {
    if (isUserRejected(err)) return { ok: false as const, rejected: true as const };
    // fall through to single tx
  }

  // Fallback: eth_sendTransaction
  try {
    const txHash = (await provider.request({
      method: "eth_sendTransaction",
      params: [
        {
          to: params.to,
          value: params.valueWei ?? "0x0",
          data: "0x",
        },
      ],
    })) as string;

    return { ok: true as const, txHash };
  } catch (err) {
    if (isUserRejected(err)) return { ok: false as const, rejected: true as const };
    return { ok: false as const, error: "Transaction failed" };
  }
}

export const CREDIT_CONTRACT = RECIPIENT;
