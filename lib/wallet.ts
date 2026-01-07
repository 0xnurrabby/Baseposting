import { isAddress, getAddress, toHex, hexToBigInt } from "viem";

export const BASE_MAINNET_CHAIN_ID_HEX = "0x2105";
export const BASE_SEPOLIA_CHAIN_ID_HEX = "0x14a34";

export const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDC_DECIMALS = 6;

export const CREDIT_CONTRACT = "0xB331328F506f2D35125e367A190e914B1b6830cF";
export const CREDIT_LOGACTION_SELECTOR = "0x2d9bc1fb"; // logAction(bytes32,bytes)

export function parseUsdcAmountToBaseUnits(amountStr: string): bigint | null {
  const s = amountStr.trim();
  if (!/^(\d+)(\.\d{0,6})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const fracPadded = (frac + "000000").slice(0, 6);
  const bi = BigInt(whole) * 10n ** 6n + BigInt(fracPadded || "0");
  if (bi <= 0n) return null;
  return bi;
}

function pad32(hexNo0x: string): string {
  return hexNo0x.padStart(64, "0");
}

export function encodeErc20Transfer(to: string, amountBaseUnits: bigint): `0x${string}` {
  if (!isAddress(to)) throw new Error("invalid_recipient");
  if (amountBaseUnits <= 0n) throw new Error("invalid_amount");
  // selector a9059cbb
  const selector = "a9059cbb";
  const toPadded = pad32(getAddress(to).slice(2).toLowerCase());
  const amountHex = amountBaseUnits.toString(16);
  const amountPadded = pad32(amountHex);
  return (`0x${selector}${toPadded}${amountPadded}`) as `0x${string}`;
}

export function bytes32FromAscii(s: string): `0x${string}` {
  // ASCII -> hex, right pad to 32 bytes
  const enc = new TextEncoder().encode(s);
  if (enc.length > 32) throw new Error("bytes32_too_long");
  let hex = "";
  for (const b of enc) hex += b.toString(16).padStart(2, "0");
  hex = hex.padEnd(64, "0");
  return (`0x${hex}`) as `0x${string}`;
}

export function encodeCreditLogAction(actionAscii: string, dataHex: `0x${string}` = "0x"): `0x${string}` {
  // logAction(bytes32 action, bytes data)
  // selector + action (32) + offset (32) + dataLen (32) + data (padded)
  const selector = CREDIT_LOGACTION_SELECTOR.slice(2); // 2d9bc1fb
  const action = bytes32FromAscii(actionAscii).slice(2);
  const offset = pad32((64).toString(16)); // data starts after 2 words
  const dataNo0x = dataHex.slice(2);
  const dataLen = pad32((dataNo0x.length / 2).toString(16));
  const paddedData = dataNo0x.padEnd(Math.ceil(dataNo0x.length / 64) * 64, "0");
  return (`0x${selector}${action}${offset}${dataLen}${paddedData}`) as `0x${string}`;
}

export type SendCallsParams = {
  version: "2.0.0";
  from: `0x${string}`;
  chainId: `0x${string}`;
  atomicRequired: true;
  calls: { to: `0x${string}`; value: "0x0"; data: `0x${string}` }[];
  capabilities: { dataSuffix: `0x${string}` };
};
