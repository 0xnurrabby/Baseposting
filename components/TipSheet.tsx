'use client';

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { toast } from "sonner";
import { sdk } from "@farcaster/miniapp-sdk";
import { isAddress, getAddress } from "viem";

const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const USDC_DECIMALS = 6;

const RECIPIENT = "0xB331328F506f2D35125e367A190e914B1b6830cF" as const;

// NOTE: You asked "no placeholders" — keeping a real value.
// If you ever want strict disable behavior, set it to "TODO_REPLACE_BUILDER_CODE" and the UI will disable.
const BUILDER_CODE = "baseposting.online";

function pad32(hexNo0x: string) {
  return hexNo0x.padStart(64, "0");
}

function parseUsdcAmount(input: string): bigint {
  const s = input.trim();
  if (!s) throw new Error("Enter an amount");
  if (!/^\d+(?:\.\d{0,6})?$/.test(s)) throw new Error("Invalid amount");

  const [whole, frac = ""] = s.split(".");
  const fracPadded = (frac + "0".repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS);

  // avoid BigInt("") edge
  const asStr = (whole || "0") + fracPadded;
  const amt = BigInt(asStr);

  if (amt <= 0n) throw new Error("Amount must be > 0");
  return amt;
}

function encodeErc20Transfer(to: string, amount: bigint): `0x${string}` {
  // selector for transfer(address,uint256)
  const selector = "a9059cbb";
  const toNo0x = to.replace(/^0x/, "");
  const amtHex = amount.toString(16);

  return `0x${selector}${pad32(toNo0x.toLowerCase())}${pad32(amtHex)}` as `0x${string}`;
}

// ✅ cache it so repeated tips don't re-import
let dataSuffixPromise: Promise<string> | null = null;

async function getDataSuffix(): Promise<string> {
  if (!dataSuffixPromise) {
    dataSuffixPromise = (async () => {
      // Remote ESM import (client-side). TS is satisfied by types/esmsh.d.ts
      const mod = await import(/* webpackIgnore: true */ "https://esm.sh/ox/erc8021");
      const { Attribution } = mod as any;
      return Attribution.toDataSuffix({ codes: [BUILDER_CODE] }) as string;
    })();
  }
  return dataSuffixPromise;
}

type Props = { open: boolean; onClose: () => void };

export function TipSheet({ open, onClose }: Props) {
  const [amount, setAmount] = React.useState("5");
  const [stage, setStage] = React.useState<"idle" | "preparing" | "confirm" | "sending" | "done">("idle");

  const preset = ["1", "5", "10", "25"];

  const canSend = React.useMemo(() => {
    try {
      const rec = getAddress(RECIPIENT);
      // builder code must be present
      if (!BUILDER_CODE || BUILDER_CODE === "TODO_REPLACE_BUILDER_CODE") return false;
      return isAddress(rec);
    } catch {
      return false;
    }
  }, []);

  const reset = () => setStage("idle");

  React.useEffect(() => {
    if (!open) reset();
  }, [open]);

  async function switchToBase(provider: any) {
    const chainId = (await provider.request({ method: "eth_chainId" })) as string;

    // Allow Base mainnet + Base sepolia
    if (chainId === "0x2105" || chainId === "0x14a34") return chainId;

    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x2105" }],
      });
      return "0x2105";
    } catch {
      throw new Error("Please switch to Base (0x2105) in your wallet.");
    }
  }

  async function sendTip() {
    try {
      if (!canSend) {
        toast.error("Tip is not configured yet.");
        return;
      }

      const provider = await sdk.wallet.getEthereumProvider();
      if (!provider) {
        throw new Error("Wallet provider unavailable. Please open inside Warpcast/Base app.");
      }

      await switchToBase(provider);

      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const from = accounts?.[0];
      if (!from) throw new Error("No wallet connected");
      if (!/^0x[a-fA-F0-9]{40}$/.test(from)) throw new Error("Invalid wallet address");

      const value = parseUsdcAmount(amount);
      const to = getAddress(RECIPIENT);
      const data = encodeErc20Transfer(to, value);

      // State machine
      setStage("preparing");
      // ✅ Pre-wallet animation required
      await new Promise((r) => setTimeout(r, 1200));
      setStage("confirm");

      const chainId = (await provider.request({ method: "eth_chainId" })) as `0x${string}`;
      const dataSuffix = await getDataSuffix();

      // ✅ ERC-5792 payload (strict, typed)
      const payload = {
        version: "2.0.0",
        from: from as `0x${string}`,
        chainId,
        atomicRequired: true,
        calls: [
          {
            to: USDC_CONTRACT as `0x${string}`,
            value: "0x0" as `0x${string}`,
            data: data as `0x${string}`,
          },
        ],
        capabilities: {
          dataSuffix,
        },
      };

      setStage("sending");
      await provider.request({ method: "wallet_sendCalls", params: [payload] });

      setStage("done");
      toast.success("Tip sent 💙");
    } catch (e: any) {
      const msg = typeof e?.message === "string" ? e.message : "Tip failed";
      if (String(msg).toLowerCase().includes("rejected")) toast("Tip cancelled");
      else toast.error(msg);
      reset();
    }
  }

  const ctaText =
    stage === "idle"
      ? "Send USDC"
      : stage === "preparing"
      ? "Preparing tip…"
      : stage === "confirm"
      ? "Confirm in wallet"
      : stage === "sending"
      ? "Sending…"
      : "Send again";

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/40" onClick={onClose} />
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="relative w-full max-w-md p-3"
          >
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-base font-semibold">Tip the builder</div>
                  <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                    Sends USDC on Base to support BasePosting.
                  </div>
                </div>
                <Button variant="ghost" onClick={onClose}>
                  Close
                </Button>
              </div>

              <div className="mt-4 grid grid-cols-4 gap-2">
                {preset.map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setAmount(p);
                      sdk.haptics?.selectionChanged?.().catch(() => {});
                    }}
                    className={[
                      "rounded-2xl border px-3 py-2 text-sm font-semibold transition",
                      amount === p
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-zinc-200/60 hover:bg-zinc-900/5 dark:border-white/10 dark:hover:bg-white/10",
                    ].join(" ")}
                  >
                    ${p}
                  </button>
                ))}
              </div>

              <div className="mt-3">
                <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Custom</label>
                <div className="mt-1 flex items-center gap-2 rounded-2xl border border-zinc-200/60 bg-white/60 px-3 py-2 dark:border-white/10 dark:bg-white/5">
                  <span className="text-sm text-zinc-500">$</span>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="5"
                    className="w-full bg-transparent text-sm outline-none"
                  />
                </div>
              </div>

              <div className="mt-4">
                <Button
                  className="w-full"
                  loading={stage === "preparing" || stage === "sending"}
                  disabled={!canSend || stage === "confirm"}
                  onClick={() => {
                    sdk.haptics?.impactOccurred?.("light").catch(() => {});
                    if (stage === "done") reset();
                    else sendTip();
                  }}
                >
                  {ctaText}
                </Button>

                {!canSend ? (
                  <div className="mt-2 text-xs text-zinc-500">
                    Tip is disabled until RECIPIENT & BUILDER_CODE are valid.
                  </div>
                ) : null}
              </div>
            </Card>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
