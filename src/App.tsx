import React, { useEffect, useMemo, useState } from "react";
import { sdk } from "@farcaster/miniapp-sdk";
import { toast, Toaster } from "sonner";
import { Button } from "./components/Button";
import { Card } from "./components/Card";
import { Pill } from "./components/Pill";
import { Skeleton } from "./components/Skeleton";
import { apiGet, apiPost, stableAnonId, type CreditsResponse, type ErrorResponse, type GenerateResponse } from "./lib/api";
import { callReadyOnce, hapticLight, loadMiniAppSession } from "./lib/miniapp";
import { applyTheme, getInitialTheme, type Theme } from "./lib/theme";
import { CREDIT_CONTRACT, getWalletInfo, sendCreditTx } from "./lib/wallet";

type MiniCtx = Awaited<typeof sdk.context>;

function utcDateString(d = new Date()) {
  // YYYY-MM-DD (UTC)
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  const [isBooting, setIsBooting] = useState(true);
  const [isMiniApp, setIsMiniApp] = useState(false);
  const [ctx, setCtx] = useState<MiniCtx | null>(null);

  const [userId, setUserId] = useState<string>("");
  const [walletAddress, setWalletAddress] = useState<string | undefined>(undefined);

  const [credits, setCredits] = useState<number>(0);
  const [lastShareUtcDate, setLastShareUtcDate] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [posting, setPosting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [toppingUp, setToppingUp] = useState(false);
  const [result, setResult] = useState<string>("");

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const safeInsets = useMemo(() => {
    const i = ctx?.client?.safeAreaInsets;
    return {
      top: i?.top ?? 0,
      bottom: i?.bottom ?? 0,
      left: i?.left ?? 0,
      right: i?.right ?? 0,
    };
  }, [ctx]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await loadMiniAppSession();
      if (cancelled) return;

      setIsMiniApp(session.isMiniApp);
      setCtx(session.context);

      // Establish the userId (FID → wallet → anon)
      const fid = session.context?.user?.fid;
      let derivedUserId = fid ? `fid:${fid}` : "";

      const wallet = await getWalletInfo();
      if (wallet.address) setWalletAddress(wallet.address);
      if (!derivedUserId && wallet.address) derivedUserId = `addr:${wallet.address.toLowerCase()}`;

      if (!derivedUserId) derivedUserId = `anon:${stableAnonId()}`;
      setUserId(derivedUserId);

      // Fetch credits
      const res = await apiGet<CreditsResponse | ErrorResponse>("/api/credits", derivedUserId);
      if (!cancelled) {
        if (res.ok) {
          setCredits(res.credits);
          setLastShareUtcDate(res.lastShareUtcDate ?? null);
        } else {
          toast.error(res.error);
        }
      }

      // Only call ready after we have rendered the shell (avoid jitter).
      setIsBooting(false);
      await callReadyOnce();
    })().catch((e) => {
      console.error(e);
      setIsBooting(false);
      callReadyOnce().catch(() => void 0);
      toast.error("Failed to initialize Mini App session");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const canGenerate = credits > 0 && !generating && !!userId;
  const canShareToday = lastShareUtcDate !== utcDateString();

  async function onGenerate() {
    hapticLight();
    if (!canGenerate) {
      toast.error(credits <= 0 ? "No credits left" : "Not ready yet");
      return;
    }
    setGenerating(true);
    setResult("");
    try {
      const res = await apiPost<GenerateResponse | ErrorResponse>("/api/generate", userId, {
        extra: prompt,
      });
      if (!res.ok) {
        toast.error(res.error);
        if (typeof res.credits === "number") setCredits(res.credits);
        return;
      }
      setCredits(res.credits);
      setResult(res.post);
      toast.success("Generated. Clean. Based.");
    } catch {
      toast.error("Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function onCopy() {
    hapticLight();
    if (!result) return;
    await navigator.clipboard.writeText(result);
    toast.success("Copied");
  }

  async function onPostDirectly() {
    hapticLight();
    if (!result) return;
    setPosting(true);
    try {
      const r = await sdk.actions.composeCast({
        text: result,
        embeds: ["https://baseposting.online/"],
      });
      if (r) toast.success("Composer opened");
    } catch {
      toast.error("Could not open composer");
    } finally {
      setPosting(false);
    }
  }

  async function onShareForCredit() {
    hapticLight();
    if (!canShareToday) {
      toast.error("Already claimed today's share bonus");
      return;
    }
    setSharing(true);
    try {
      const shareText =
        "I’m using BasePosting to turn fresh X posts into unique Base bangers. Come cook with me 🔵";
      const r = await sdk.actions.composeCast({
        text: shareText,
        embeds: ["https://baseposting.online/"],
      });

      if (!r) {
        toast.message("Share cancelled");
        return;
      }

      const res = await apiPost<{ ok: true; credits: number; lastShareUtcDate: string } | ErrorResponse>(
        "/api/share",
        userId,
        { didShare: true }
      );

      if (res.ok) {
        setCredits(res.credits);
        setLastShareUtcDate(res.lastShareUtcDate);
        toast.success("+2 credits added");
      } else {
        toast.error(res.error);
      }
    } catch {
      toast.error("Share failed");
    } finally {
      setSharing(false);
    }
  }

  async function onGetCredit() {
    hapticLight();
    setToppingUp(true);
    try {
      const tx = await sendCreditTx({ to: CREDIT_CONTRACT as `0x${string}` });
      if (!tx.ok) {
        if ((tx as any).rejected) toast.message("Transaction cancelled");
        else toast.error(tx.error ?? "Transaction failed");
        return;
      }

      toast.message("Verifying onchain…");

      const res = await apiPost<{ ok: true; credits: number } | ErrorResponse>("/api/verify-tx", userId, {
        txHash: tx.txHash,
        contract: CREDIT_CONTRACT,
      });

      if (res.ok) {
        setCredits(res.credits);
        toast.success("+1 credit added");
      } else {
        toast.error(res.error);
      }
    } catch {
      toast.error("Could not send transaction");
    } finally {
      setToppingUp(false);
    }
  }

  const title = "BasePosting";
  const tagline = "Scrape fresh X posts. Generate unique Base bangers.";

  return (
    <div
      className="min-h-full bg-zinc-950 text-white dark:bg-zinc-950 dark:text-white"
      style={{
        paddingTop: safeInsets.top ? safeInsets.top + 12 : 16,
        paddingBottom: safeInsets.bottom ? safeInsets.bottom + 12 : 16,
        paddingLeft: safeInsets.left ? safeInsets.left + 12 : 16,
        paddingRight: safeInsets.right ? safeInsets.right + 12 : 16,
      }}
    >
      <Toaster richColors closeButton />
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <header className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-extrabold tracking-tight">{title}</h1>
              <Pill tone={credits > 0 ? "neutral" : "danger"}>Credits: {credits}</Pill>
            </div>
            <p className="text-sm text-white/70">{tagline}</p>
          </div>

          <Button
            variant="ghost"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "Light" : "Dark"}
          </Button>
        </header>

        {!isMiniApp && (
          <Card>
            <div className="space-y-2">
              <Pill tone="danger">Not in Mini App</Pill>
              <p className="text-sm text-white/80">
                Open this inside a Farcaster/Base Mini App surface (Warpcast / Base app) to get the full Mini App chrome
                + wallet + share flow.
              </p>
            </div>
          </Card>
        )}

        <Card>
          <div className="space-y-3">
            <label className="text-sm font-semibold text-white/90">Extra context</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder='e.g. "make it bullish", "meme style", "short + punchy", "no emojis"'
              className="min-h-[92px] w-full resize-none rounded-2xl bg-black/30 p-3 text-sm text-white placeholder:text-white/35 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-white/20"
            />

            <Button variant="primary" onClick={onGenerate} loading={generating} disabled={!canGenerate}>
              Generate (1 credit)
            </Button>

            {isBooting && <Skeleton lines={4} />}

            {result && (
              <div className="space-y-3">
                <div className="rounded-2xl bg-black/30 p-4 ring-1 ring-white/10">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/90">{result}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Button variant="secondary" onClick={onPostDirectly} loading={posting}>
                    Post Directly
                  </Button>
                  <Button variant="secondary" onClick={onCopy}>
                    Copy
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="text-sm font-semibold">Share for 2 credits</div>
                  <div className="text-xs text-white/60">Once per UTC day</div>
                </div>
                <Pill tone={canShareToday ? "success" : "neutral"}>{canShareToday ? "Available" : "Used"}</Pill>
              </div>
              <Button variant="secondary" onClick={onShareForCredit} loading={sharing} disabled={!canShareToday}>
                Share
              </Button>
            </div>
          </Card>

          <Card>
            <div className="space-y-3">
              <div className="space-y-1">
                <div className="text-sm font-semibold">Get Credit (onchain)</div>
                <div className="text-xs text-white/60">1 credit per successful tx</div>
              </div>
              <Button variant="secondary" onClick={onGetCredit} loading={toppingUp}>
                Get Credit
              </Button>

              <div className="text-[11px] text-white/45">
                Contract: <span className="font-mono">{CREDIT_CONTRACT}</span>
                {walletAddress ? (
                  <div>
                    Wallet: <span className="font-mono">{walletAddress}</span>
                  </div>
                ) : null}
              </div>
            </div>
          </Card>
        </div>

        <footer className="pt-2 text-center text-xs text-white/40">
          Powered by Apify + GPT • Built for Base + Farcaster Mini Apps
        </footer>
      </div>
    </div>
  );
}
