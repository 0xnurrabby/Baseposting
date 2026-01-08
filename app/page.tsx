"use client";

import * as React from "react";
import { sdk } from "@farcaster/miniapp-sdk";
import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { Badge } from "@/components/badge";
import { Skeleton } from "@/components/skeleton";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { encodeFunctionData, erc20Abi } from "viem";
import { USDC_BASE_MAINNET, USDC_BASE_SEPOLIA } from "@/lib/onchain";

declare global {
  interface Window {
    __bp_dataSuffix?: string;
  }
}

type CreditsState = {
  credits: number;
  dailyShareUsed: boolean;
  userId: string | null;
};

type MiniState = {
  inMiniApp: boolean;
  fid?: number;
  address?: `0x${string}`;
  chainIdHex?: string;
};

const APP_URL = "https://baseposting.online/";

function haptic(kind: "light" | "medium" = "light") {
  try { sdk.haptics?.impactOccurred?.(kind); } catch {}
}

export default function Home() {
  const { theme, setTheme } = useTheme();

  const [mini, setMini] = React.useState<MiniState>({ inMiniApp: false });
  const [booted, setBooted] = React.useState(false);

  const [credits, setCredits] = React.useState<CreditsState>({
    credits: 0,
    dailyShareUsed: false,
    userId: null,
  });

  const [extra, setExtra] = React.useState("");
  const [generating, setGenerating] = React.useState(false);
  const [result, setResult] = React.useState<string | null>(null);
  const [loadingCredits, setLoadingCredits] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      const inMiniApp = await sdk.isInMiniApp().catch(() => false);
      if (!inMiniApp) {
        setMini({ inMiniApp: false });
        setBooted(true);
        setLoadingCredits(false);
        return;
      }

      await sdk.actions.ready();

      const ctx = await sdk.context;
      const fid = ctx?.user?.fid;

      let address: `0x${string}` | undefined;
      let chainIdHex: string | undefined;

      try {
        const provider = await sdk.wallet.getEthereumProvider();
        const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
        address = (accounts?.[0] as any) || undefined;
        chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
      } catch {}

      setMini({ inMiniApp: true, fid, address, chainIdHex });
      setBooted(true);

      const userId = fid ? `fid:${fid}` : address ? `addr:${address.toLowerCase()}` : null;
      if (!userId) {
        toast.error("Couldn’t detect user identity (FID/wallet).");
        setLoadingCredits(false);
        return;
      }

      await refreshCredits(userId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshCredits(userId: string) {
    setLoadingCredits(true);
    const res = await fetch(`${APP_URL}api/credits`, {
      headers: { "x-user-id": userId },
      cache: "no-store",
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      setLoadingCredits(false);
      toast.error("Failed to load credits.");
      return;
    }
    setCredits({
      credits: data.credits ?? 0,
      dailyShareUsed: !!data.dailyShareUsed,
      userId,
    });
    setLoadingCredits(false);
  }

  const canGenerate = credits.userId && credits.credits >= 1 && !generating;
  const canShare = credits.userId && !credits.dailyShareUsed;
  const canOnchain = !!credits.userId;

  async function handleGenerate() {
    haptic("light");
    if (!mini.inMiniApp) return toast.error("This must be opened as a Farcaster Mini App.");
    if (!credits.userId) return;
    if (credits.credits < 1) return toast.error("No credits. Share once daily (+2) or get credit onchain (+1).");

    setGenerating(true);
    setResult(null);

    // optimistic
    setCredits((c) => ({ ...c, credits: Math.max(0, c.credits - 1) }));

    try {
      const res = await fetch(`${APP_URL}api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-user-id": credits.userId },
        body: JSON.stringify({ extraContext: extra }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.text) {
        await refreshCredits(credits.userId);
        throw new Error(data?.error || "Generation failed");
      }

      setResult(String(data.text));
      setCredits((c) => ({ ...c, credits: typeof data.credits === "number" ? data.credits : c.credits }));
      toast.success("Generated.");
      haptic("medium");
    } catch (e: any) {
      toast.error(e?.message || "Something went wrong.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy() {
    haptic("light");
    if (!result) return;
    await navigator.clipboard.writeText(result).catch(() => {});
    toast.success("Copied");
    haptic("light");
  }

  async function handlePostDirectly() {
    haptic("light");
    if (!result) return;
    if (!mini.inMiniApp) return toast.error("Open inside Farcaster to post directly.");
    try {
      await (sdk.actions as any).composeCast?.({ text: result });
      toast.success("Compose opened.");
      haptic("medium");
    } catch {
      toast.error("Couldn’t open compose.");
    }
  }

  async function handleDailyShare() {
    haptic("light");
    if (!mini.inMiniApp) return toast.error("Open inside Farcaster.");
    if (!credits.userId) return;
    if (credits.dailyShareUsed) return toast.error("Already used today.");

    const shareText = "Just generated a Base banger with BasePosting. ⚡️\n\nTry it: https://baseposting.online/";
    try {
      await (sdk.actions as any).composeCast?.({ text: shareText });

      const res = await fetch(`${APP_URL}api/credits/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-user-id": credits.userId },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Share credit failed");

      setCredits((c) => ({ ...c, credits: data.credits ?? c.credits, dailyShareUsed: true }));
      toast.success("+2 credits (daily).");
      haptic("medium");
    } catch (e: any) {
      toast.error(e?.message || "Failed.");
    }
  }

  async function ensureBaseChain(provider: any): Promise<string> {
    const chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
    if (chainIdHex?.toLowerCase() === "0x2105" || chainIdHex?.toLowerCase() === "0x14a34") return chainIdHex;

    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] });
      return "0x2105";
    } catch {
      throw new Error("Please switch to Base (0x2105) to get credit onchain.");
    }
  }

  async function handleGetCreditOnchain() {
    haptic("light");
    if (!mini.inMiniApp) return toast.error("Open inside Farcaster.");
    if (!credits.userId) return;

    try {
      const provider = await sdk.wallet.getEthereumProvider();
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const from = accounts?.[0];
      if (!from) throw new Error("No wallet connected.");

      const chainId = await ensureBaseChain(provider);

      const treasury = (process.env.NEXT_PUBLIC_TREASURY_ADDRESS as `0x${string}` | undefined) ?? "0x0000000000000000000000000000000000000000";
      if (treasury.toLowerCase() === "0x0000000000000000000000000000000000000000") throw new Error("Treasury address is not set.");

      const usdc = (chainId.toLowerCase() === "0x14a34") ? USDC_BASE_SEPOLIA : USDC_BASE_MAINNET;
      const amount = BigInt(process.env.NEXT_PUBLIC_USDC_AMOUNT ?? "1000"); // 0.001 USDC (6 decimals)

      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [treasury, amount],
      });

      const dataSuffix = window.__bp_dataSuffix;
      if (!dataSuffix) throw new Error("Builder code attribution not loaded.");

      const payload = {
        version: "2.0.0",
        from,
        chainId,
        atomicRequired: true,
        calls: [{
          to: usdc,
          value: "0x0",
          data
        }],
        capabilities: {
          dataSuffix
        }
      };

      const id = await provider.request({ method: "wallet_sendCalls", params: [payload] }) as string;

      toast.success("Transaction submitted. Confirming…");

      let txHash: `0x${string}` | null = null;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1200));
        try {
          const st = await provider.request({ method: "wallet_getCallsStatus", params: [id] }) as any;
          const receipts = st?.receipts ?? st?.result?.receipts ?? [];
          const h = receipts?.[0]?.transactionHash ?? receipts?.[0]?.txHash ?? null;
          if (h && typeof h === "string" && h.startsWith("0x")) {
            txHash = h as `0x${string}`;
            break;
          }
          const status = String(st?.status ?? st?.result?.status ?? "").toLowerCase();
          if (status === "reverted") throw new Error("Transaction reverted.");
        } catch {}
      }

      if (!txHash) {
        toast.error("Could not confirm tx hash automatically (wallet may not support status).");
        return;
      }

      const verifyRes = await fetch(`${APP_URL}api/credits/onchain`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-user-id": credits.userId },
        body: JSON.stringify({ txHash, chainIdHex: chainId }),
      });
      const verifyData = await verifyRes.json().catch(() => null);
      if (!verifyRes.ok) throw new Error(verifyData?.error || "Verification failed.");

      setCredits((c) => ({ ...c, credits: verifyData.credits ?? c.credits }));
      toast.success("+1 credit (onchain).");
      haptic("medium");
    } catch (e: any) {
      const msg = e?.message || "Wallet action failed.";
      if (String(msg).toLowerCase().includes("rejected")) toast("Cancelled.");
      else toast.error(msg);
    }
  }

  const header = (
    <div className="flex items-center justify-between gap-3">
      <div className="space-y-1">
        <div className="text-lg font-extrabold tracking-tight">BasePosting</div>
        <div className="text-sm text-zinc-600 dark:text-zinc-400">Apify → GPT → Base bangers that feel like you.</div>
      </div>

      <div className="flex items-center gap-2">
        {loadingCredits ? (
          <Badge className="min-w-[92px] justify-center">
            <Skeleton className="h-3 w-12" />
          </Badge>
        ) : (
          <Badge className="min-w-[92px] justify-center">
            <span className="opacity-70">Credits</span>
            <span className="font-extrabold">{credits.credits}</span>
          </Badge>
        )}

        <button
          className="rounded-2xl border border-zinc-200/70 bg-white/70 px-3 py-2 text-xs font-semibold text-zinc-950 shadow-soft backdrop-blur transition active:scale-[0.98] dark:border-zinc-800/80 dark:bg-zinc-950/70 dark:text-zinc-50"
          onClick={() => { haptic("light"); setTheme(theme === "dark" ? "light" : "dark"); }}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? "Light" : "Dark"}
        </button>
      </div>
    </div>
  );

  if (!booted) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-4 p-4">
        <Card className="mt-10">
          <Skeleton className="h-6 w-40" />
          <div className="mt-2 space-y-2">
            <Skeleton className="h-4 w-80" />
            <Skeleton className="h-4 w-64" />
          </div>
        </Card>
      </main>
    );
  }

  if (!mini.inMiniApp) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-4 p-4">
        <Card className="mt-10">
          <div className="text-xl font-extrabold tracking-tight">Mini App only</div>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            This experience must be opened as a Farcaster Mini App (no address bar / browser mode).
          </p>
          <div className="mt-4">
            <a
              className="inline-flex rounded-2xl border border-zinc-200/70 bg-white/70 px-4 py-3 text-sm font-semibold text-zinc-950 shadow-soft backdrop-blur dark:border-zinc-800/80 dark:bg-zinc-950/70 dark:text-zinc-50"
              href="https://baseposting.online/"
            >
              Use Farcaster Mini App launcher
            </a>
          </div>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-4 p-4">
      <Card className="mt-2">
        {header}

        <div className="mt-5">
          <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Extra context (optional)</label>
          <textarea
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            placeholder='e.g. "make it bullish", "meme style", "dev angle", "short + savage"'
            className={cn(
              "mt-2 w-full resize-none rounded-2xl border border-zinc-200/70 bg-white px-4 py-3 text-sm outline-none",
              "focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-800/80 dark:bg-zinc-950 dark:focus:ring-zinc-500/30"
            )}
            rows={3}
          />
        </div>

        <div className="mt-4">
          <Button loading={generating} disabled={!canGenerate} onClick={handleGenerate} className="w-full">
            Generate
          </Button>
          {!canGenerate && credits.credits < 1 && (
            <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
              You need credits to generate.
            </div>
          )}
        </div>

        <div className="mt-4">
          {generating ? (
            <Card className="border-dashed">
              <div className="space-y-2">
                <Skeleton className="h-4 w-[90%]" />
                <Skeleton className="h-4 w-[78%]" />
                <Skeleton className="h-4 w-[60%]" />
              </div>
            </Card>
          ) : result ? (
            <Card className="border-zinc-200/70 dark:border-zinc-800/80">
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{result}</div>
            </Card>
          ) : (
            <Card className="border-dashed">
              <div className="text-sm text-zinc-600 dark:text-zinc-400">Your generated post will appear here.</div>
            </Card>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Button variant="secondary" disabled={!result} onClick={handlePostDirectly}>
            Post Directly
          </Button>
          <Button variant="secondary" disabled={!result} onClick={handleCopy}>
            Copy
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Button
            variant="ghost"
            disabled={!canShare}
            onClick={handleDailyShare}
            className="border border-zinc-200/70 bg-white/70 shadow-soft dark:border-zinc-800/80 dark:bg-zinc-950/70"
          >
            Share for 2 credit
          </Button>
          <Button
            variant="ghost"
            disabled={!canOnchain}
            onClick={handleGetCreditOnchain}
            className="border border-zinc-200/70 bg-white/70 shadow-soft dark:border-zinc-800/80 dark:bg-zinc-950/70"
          >
            Get Credit
          </Button>
        </div>

        <div className="mt-4 text-xs text-zinc-600 dark:text-zinc-400">
          Identity: {mini.fid ? `FID ${mini.fid}` : mini.address ? mini.address : "Unknown"}
        </div>
      </Card>
    </main>
  );
}
