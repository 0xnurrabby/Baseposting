'use client';

import { sdk } from "@farcaster/miniapp-sdk";

export async function safeReady() {
  try {
    await sdk.actions.ready();
  } catch {
    // If not in a host, do nothing.
  }
}

export async function getMiniAppUserId(): Promise<{ userId: string; fid?: number; address?: string }> {
  // Prefer FID, fallback to wallet address.
  const fid = sdk.context?.user?.fid;
  let address: string | undefined;
  try {
    const provider = await sdk.wallet.getEthereumProvider();
    const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[] | undefined;
    address = accounts?.[0];
  } catch {
    // ignore
  }
  const userId = fid ? `fid:${fid}` : address ? `addr:${address.toLowerCase()}` : `anon:${crypto.randomUUID()}`;
  return { userId, fid: typeof fid === "number" ? fid : undefined, address };
}
