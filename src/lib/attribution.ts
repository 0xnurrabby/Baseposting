import { Attribution } from "https://esm.sh/ox/erc8021";

export const BUILDER_CODE = "BASEPOSTING_ONLINE_V1";

// Recipient is used for wallet-based send flows (kept valid + checksummed).
export const RECIPIENT = "0xB331328F506f2D35125e367A190e914B1b6830cF";

export function getDataSuffix() {
  try {
    return Attribution.toDataSuffix({
      codes: [BUILDER_CODE],
    });
  } catch {
    return undefined;
  }
}

export function canSendWithAttribution(): { ok: boolean; reason?: string } {
  if (!BUILDER_CODE || BUILDER_CODE.includes("TODO")) return { ok: false, reason: "BUILDER_CODE not set" };
  if (!RECIPIENT || RECIPIENT.includes("TODO")) return { ok: false, reason: "RECIPIENT not set" };
  return { ok: true };
}
