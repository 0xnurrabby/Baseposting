import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { encodeErc20Transfer, parseUsdcAmountToBaseUnits, USDC_CONTRACT, BASE_MAINNET_CHAIN_ID_HEX } from "../lib/wallet";
import type { SendCallsParams } from "../lib/wallet";
import { sdk } from "@farcaster/miniapp-sdk";

const RECIPIENT = "0x0000000000000000000000000000000000000000";

type Props = {
  open: boolean;
  onClose: () => void;
};

type TipState = "idle" | "preparing" | "confirm" | "sending" | "done";

const PRESETS = [
  { label: "$1", value: "1" },
  { label: "$5", value: "5" },
  { label: "$10", value: "10" },
  { label: "$25", value: "25" },
];

function isTodoRecipient(addr: string) {
  return addr.toLowerCase() === "0x0000000000000000000000000000000000000000";
}

export function TipSheet({ open, onClose }: Props) {
  const [amount, setAmount] = useState("5");
  const [state, setState] = useState<TipState>("idle");

  const canSend = useMemo(() => {
    const b = window.__BASEPOSTING_BUILDER__;
    const hasBuilder = Boolean(b?.dataSuffix) && b?.BUILDER_CODE !== "TODO_REPLACE_BUILDER_CODE";
    const hasRecipient = !isTodoRecipient(RECIPIENT);
    return hasBuilder && hasRecipient;
  }, [open]);

  const ctaLabel =
    state === "idle"
      ? "Send USDC"
      : state === "preparing"
        ? "Preparing tip…"
        : state === "confirm"
          ? "Confirm in wallet"
          : state === "sending"
            ? "Sending…"
            : "Send again";

  async function sendTip() {
    try {
      if (!sdk.isInMiniApp()) {
        toast.error("Open inside Farcaster as a Mini App (no browser mode).");
        return;
      }

      const b = window.__BASEPOSTING_BUILDER__;
      if (!b || b.BUILDER_CODE === "TODO_REPLACE_BUILDER_CODE") {
        toast.error("Builder code missing. Replace BUILDER_CODE in /public/sdk/attribution.js");
        return;
      }
      if (isTodoRecipient(RECIPIENT)) {
        toast.error("Recipient not set. Replace RECIPIENT in TipSheet.tsx");
        return;
      }

      const amountUnits = parseUsdcAmountToBaseUnits(amount);
      if (!amountUnits) {
        toast.error("Invalid amount");
        return;
      }

     const provider = await sdk.wallet.getEthereumProvider();
if (!provider) {
  toast.error("Wallet provider not available. Open inside Farcaster Mini App.");
  setState("idle");
  return;
}

const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];

      const from = accounts?.[0];
      if (!from) throw new Error("no_account");

      let chainId = (await provider.request({ method: "eth_chainId" })) as string;
      if (chainId !== BASE_MAINNET_CHAIN_ID_HEX) {
        try {
          await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_MAINNET_CHAIN_ID_HEX }] });
          chainId = BASE_MAINNET_CHAIN_ID_HEX;
        } catch (e) {
          toast.error("Please switch to Base Mainnet in your wallet.");
          return;
        }
      }

      const data = encodeErc20Transfer(RECIPIENT, amountUnits);

      // UX requirement: animate BEFORE wallet opens
      setState("preparing");
      await new Promise((r) => setTimeout(r, 1200));

      setState("confirm");

      const params: SendCallsParams = {
        version: "2.0.0",
        from: from as `0x${string}`,
        chainId: chainId as `0x${string}`,
        atomicRequired: true,
        calls: [
          {
            to: USDC_CONTRACT,
            value: "0x0",
            data,
          },
        ],
        capabilities: {
          dataSuffix: b.dataSuffix,
        },
      };

      setState("sending");
      await provider.request({ method: "wallet_sendCalls", params: [params] });

      setState("done");
      toast.success("Tip sent ✅");
    } catch (e: any) {
      const code = e?.code;
      if (code === 4001) {
        toast("Tip canceled");
      } else {
        toast.error("Tip failed");
      }
      setState("idle");
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-50 bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => (state === "sending" ? null : onClose())}
          />
          <motion.div
            className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-xl rounded-t-3xl terminal-border p-4"
            initial={{ y: 420, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 420, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Tip</div>
                <div className="text-xs text-slate-400">Send USDC on Base Mainnet</div>
              </div>
              <button className="btn" onClick={onClose} disabled={state === "sending"}>
                Close
              </button>
            </div>

            <div className="mt-4 grid grid-cols-4 gap-2">
              {PRESETS.map((p) => (
                <button key={p.value} className={"btn " + (amount === p.value ? "btn-primary" : "")} onClick={() => setAmount(p.value)}>
                  {p.label}
                </button>
              ))}
            </div>

            <div className="mt-3">
              <div className="text-xs text-slate-400 mb-1">Custom amount</div>
              <input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="5" />
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="text-xs text-slate-400">
                {canSend ? (
                  <span>Ready.</span>
                ) : (
                  <span>
                    Sending disabled until you set <span className="text-cyan-200">RECIPIENT</span> and <span className="text-cyan-200">BUILDER_CODE</span>.
                  </span>
                )}
              </div>
              <button className="btn btn-primary" onClick={state === "done" ? () => setState("idle") : sendTip} disabled={!canSend || state === "preparing" || state === "confirm" || state === "sending"}>
                {ctaLabel}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
