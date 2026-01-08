'use client';

import * as React from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Skeleton } from "@/components/Skeleton";
import { TipSheet } from "@/components/TipSheet";
import { safeReady, getMiniAppUserId } from "@/lib/miniapp";
import { sdk } from "@farcaster/miniapp-sdk";
import { Copy, Sparkles, Send, Coins, Share2, RefreshCcw, Moon, Sun } from "lucide-react";
import { cn } from "@/components/cn";

type Status = { userId: string; credits: number; lastShareDate: string | null; todayUtc: string };

export default function Page() {
  const [context, setContext] = React.useState("");
  const [result, setResult] = React.useState<string | null>(null);
  const [sourceHint, setSourceHint] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [status, setStatus] = React.useState<Status | null>(null);
  const [tipOpen, setTipOpen] = React.useState(false);
  const [theme, setTheme] = React.useState<"light" | "dark">("dark");

  React.useEffect(() => {
    // Mini App: always call ready to hide splash.
    safeReady();

    // Default theme based on system (but allow toggle)
    try {
      const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
      setTheme(prefersDark ? "dark" : "light");
      document.documentElement.classList.toggle("dark", prefersDark);
    } catch {}

    refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshStatus() {
    try {
      const { userId } = await getMiniAppUserId();
      const r = await fetch("/api/credits/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Failed to load credits");
      setStatus(j);
    } catch (e: any) {
      setStatus(null);
    }
  }

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    sdk.haptics?.selectionChanged?.().catch(() => {});
  }

  async function generate(regenerate = false) {
    try {
      setLoading(true);
      setSourceHint(null);
      if (!regenerate) setResult(null);

      const { userId } = await getMiniAppUserId();
      const r = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, context }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Generation failed");

      setResult(j.text);
      setSourceHint(j.sourceHint ?? null);
      setStatus((s) => (s ? { ...s, credits: j.credits } : s));
      toast.success("Generated ✨");
      sdk.haptics?.notificationOccurred?.("success").catch(() => {});
    } catch (e: any) {
      toast.error(e?.message ?? "Something went wrong");
      sdk.haptics?.notificationOccurred?.("error").catch(() => {});
      await refreshStatus();
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!result) return;
    await navigator.clipboard.writeText(result);
    toast("Copied");
    sdk.haptics?.impactOccurred?.("light").catch(() => {});
  }

  async function postDirectly() {
    if (!result) return;
    try {
      const embeds = ["https://baseposting.online/"];
      const out = await sdk.actions.composeCast({ text: result, embeds });
      if (out?.cast) toast.success("Cast composer opened");
    } catch {
      // last-resort fallback (not ideal, but better than nothing)
      const url = `https://warpcast.com/~/compose?text=${encodeURIComponent(result)}`;
      await sdk.actions.openUrl(url);
    }
  }

  async function shareForCredits() {
    try {
      const { userId } = await getMiniAppUserId();
      const shareText = "Just generated a Base banger with BasePosting 🟦";
      const out = await sdk.actions.composeCast({ text: shareText, embeds: ["https://baseposting.online/"] });

      if (!out?.cast) {
        toast("Share cancelled");
        return;
      }

      const r = await fetch("/api/credits/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Share credit failed");

      setStatus((s) => (s ? { ...s, credits: j.credits, lastShareDate: j.todayUtc } : s));
      toast.success("+2 credits");
    } catch (e: any) {
      toast.error(e?.message ?? "Share failed");
    }
  }

  async function getCreditTx() {
    try {
      const { userId } = await getMiniAppUserId();
      const provider = await sdk.wallet.getEthereumProvider();

      // Ensure Base
      const chainId = (await provider.request({ method: "eth_chainId" })) as string;
      if (chainId !== "0x2105" && chainId !== "0x14a34") {
        try {
          await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] });
        } catch {
          throw new Error("Switch to Base (0x2105) to get credits.");
        }
      }

      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const from = accounts?.[0];
      if (!from) throw new Error("No wallet connected");

      toast("Preparing transaction…");
      await new Promise((r) => setTimeout(r, 900));

      const txHash = (await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from,
            to: "0xB331328F506f2D35125e367A190e914B1b6830cF",
            value: "0x0",
            data: "0x",
          },
        ],
      })) as string;

      toast("Verifying on Base…");
      const r = await fetch("/api/credits/tx", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, txHash }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Verification failed");

      setStatus((s) => (s ? { ...s, credits: j.credits } : s));
      toast.success("+1 credit");
    } catch (e: any) {
      const msg = e?.message ?? "Failed";
      if (String(msg).toLowerCase().includes("rejected")) toast("Cancelled");
      else toast.error(msg);
    }
  }

  const credits = status?.credits ?? 0;

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
        <header className="flex items-center justify-between">
          <div>
            <div className="text-xl font-semibold tracking-tight">BasePosting</div>
            <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
              Turn live X posts into unique, human-like Base bangers.
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="rounded-2xl border border-zinc-200/60 bg-white/60 p-3 transition hover:bg-zinc-900/5 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <div className="rounded-2xl border border-zinc-200/60 bg-white/60 px-3 py-2 text-sm font-semibold dark:border-white/10 dark:bg-white/5">
              <span className="text-zinc-500">Credits</span>{" "}
              <span className={cn("ml-1", credits <= 2 ? "text-amber-600 dark:text-amber-400" : "")}>{credits}</span>
            </div>
          </div>
        </header>

        <Card>
          <div className="text-sm font-semibold">Extra context</div>
          <div className="mt-2">
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder='e.g. "make it bullish", "meme style", "for builders", "short one-liner"'
              className="min-h-[96px] w-full resize-none rounded-2xl border border-zinc-200/60 bg-white/60 p-3 text-sm outline-none transition focus:border-blue-500 dark:border-white/10 dark:bg-white/5"
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              className="min-w-[180px]"
              loading={loading}
              disabled={credits <= 0}
              onClick={() => generate(false)}
            >
              <Sparkles className="h-4 w-4" />
              Generate
            </Button>

            <Button variant="secondary" onClick={() => setTipOpen(true)}>
              <Send className="h-4 w-4" />
              Tip
            </Button>

            <Button variant="secondary" onClick={getCreditTx}>
              <Coins className="h-4 w-4" />
              Get Credit
            </Button>

            <Button variant="secondary" onClick={shareForCredits} disabled={!!status?.lastShareDate && status.lastShareDate === status.todayUtc}>
              <Share2 className="h-4 w-4" />
              Share for 2 credit
            </Button>
          </div>

          {credits <= 0 ? (
            <div className="mt-3 text-sm text-amber-700 dark:text-amber-300">
              Out of credits — share or run “Get Credit” to keep posting.
            </div>
          ) : null}
        </Card>

        <AnimatePresence>
          {loading ? (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              className="grid gap-3"
            >
              <Card>
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="mt-3 h-20 w-full" />
                <div className="mt-4 flex gap-2">
                  <Skeleton className="h-10 w-24" />
                  <Skeleton className="h-10 w-24" />
                </div>
              </Card>
            </motion.div>
          ) : result ? (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid gap-3"
            >
              <Card>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Generated post</div>
                    {sourceHint ? (
                      <div className="mt-1 text-xs text-zinc-500">{sourceHint}</div>
                    ) : null}
                  </div>

                  <Button variant="ghost" onClick={() => generate(true)} disabled={credits <= 0}>
                    <RefreshCcw className="h-4 w-4" />
                    Regenerate
                  </Button>
                </div>

                <div className="mt-3 whitespace-pre-wrap rounded-2xl border border-zinc-200/60 bg-white/60 p-3 text-sm leading-relaxed dark:border-white/10 dark:bg-white/5">
                  {result}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button onClick={postDirectly}>
                    <Send className="h-4 w-4" />
                    Post Directly
                  </Button>
                  <Button variant="secondary" onClick={copy}>
                    <Copy className="h-4 w-4" />
                    Copy
                  </Button>
                </div>
              </Card>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <footer className="pt-2 text-center text-xs text-zinc-500">
          Powered by Apify + OpenAI. Built for Base + Farcaster Mini Apps.
        </footer>
      </div>

      <TipSheet open={tipOpen} onClose={() => setTipOpen(false)} />
    </div>
  );
}
