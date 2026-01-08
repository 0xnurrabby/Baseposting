import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { env } from "@/lib/env";

export const BASE_CHAIN_ID = 8453; // 0x2105

export const publicClient = createPublicClient({
  chain: base,
  transport: http(env.BASE_RPC_URL ?? "https://mainnet.base.org"),
});

export const CREDIT_CONTRACT = "0xB331328F506f2D35125e367A190e914B1b6830cF";
