import { useEffect, useMemo, useRef, useState } from "react";
import { sdk } from "@farcaster/miniapp-sdk";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Panel, Divider, FadeIn, Badge, SmallLabel } from "../components/ui";
import { TipSheet } from "../components/TipSheet";
import { encodeCreditLogAction, CREDIT_CONTRACT, BASE_MAINNET_CHAIN_ID_HEX } from "../lib/wallet";

type FeedItem = {
  tweetId: string;
  timestamp: string;
  handle: string;
  text: string;
  url?: string | null;
  likes: number;
  reposts: number;
  replies: number;
  views: number;
  isReply: boolean;
  isRetweet: boolean;
};

type Variant = {
  id: string;
  angle: string;
  text: string;
  stylePreset: string;
  length: string;
  category: string;
  confidence: string;
};

const APP_URL = "https://baseposting.online/";
const STYLE_PRESETS = ["degen", "builder", "educational", "story", "thread-ish", "checklist", "question-hook"] as const;

function timeAgo(iso: string) {
  const d = new Date(iso);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const day = Math.floor(h / 24);
  return `${day}d`;
}

function clampText(s: string, n = 84) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

async function authedFetch(token: string, input: RequestInfo, init?: RequestInit) {
  const headers = new Headers(init?.headers ?? {});
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

export default function Home() {
  const [isMiniApp, setIsMiniApp] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);

  const [token, setToken] = useState<string | null>(null);
  const [fid, setFid] = useState<number | null>(null);
  const [credits, setCredits] = useState<number>(0);
  const [userLabel, setUserLabel] = useState<string>("");

  const [logs, setLogs] = useState<string[]>(["booting…"]);
  const logRef = useRef<HTMLDivElement | null>(null);

  const [baseOnly, setBaseOnly] = useState(true);
  const [includeReplies, setIncludeReplies] = useState(false);
  const [search, setSearch] = useState("");

  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [selected, setSelected] = useState<FeedItem | null>(null);

  const [stylePreset, setStylePreset] = useState<(typeof STYLE_PRESETS)[number]>("builder");
  const [length, setLength] = useState<"short" | "medium" | "long">("medium");
  const [variantCount, setVariantCount] = useState<3 | 5 | 10>(5);
  const [creditOnInfo, setCreditOnInfo] = useState(true);

  const [variants, setVariants] = useState<Variant[]>([]);
  const [genMeta, setGenMeta] = useState<{ category?: string; confidence?: string } | null>(null);

  const [tipOpen, setTipOpen] = useState(false);

  const commandHint = useMemo(() => {
    return "SYNC → pick a post → GENERATE → Copy/Post";
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs]);

  function pushLog(line: string) {
    setLogs((l) => [...l, line].slice(-250));
  }

  useEffect(() => {
    (async () => {
      try {
        const mini = await sdk.isInMiniApp();
setIsMiniApp(mini);


        if (!mini) return;

        // Always call ready (required).
        // Small delay lets layout stabilize; avoids jank.
        setTimeout(() => {
          sdk.actions.ready();
          setReady(true);
        }, 50);

        pushLog("sdk: ready()");
        pushLog("auth: requesting token…");

        const t = await sdk.quickAuth.getToken();
        setToken(t);

        const ctx = await sdk.context;
        const u = ctx?.user;
        const label = u?.username ? `@${u.username}` : `fid:${ctx?.fid ?? "?"}`;
        setUserLabel(label);
        setFid(ctx?.fid ?? null);

        const r = await authedFetch(t, "/api/auth/me", {
          headers: {
            "x-fc-user": JSON.stringify({
              username: u?.username ?? null,
              displayName: u?.displayName ?? null,
              pfpUrl: u?.pfpUrl ?? null,
              primaryWallet: ctx?.address ?? null,
            }),
          },
        });
        const me = await r.json();
        if (r.ok) {
          setCredits(me.credits ?? 0);
          pushLog(`credits: ${me.credits ?? 0}`);
        } else {
          pushLog(`auth error: ${me.error ?? "unknown"}`);
        }

        pushLog(commandHint);
      } catch (e: any) {
        setIsMiniApp(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshFeed() {
    if (!token) return;
    pushLog("feed: fetching latest 50…");
    const qs = new URLSearchParams({
      baseOnly: baseOnly ? "1" : "0",
      includeReplies: includeReplies ? "1" : "0",
      q: search,
    });
    const r = await authedFetch(token, `/api/posts?${qs.toString()}`);
    const j = await r.json();
    if (!r.ok) {
      pushLog(`feed error: ${j.error ?? "unknown"}`);
      return;
    }
    setFeed(j.items ?? []);
    pushLog(`feed: loaded ${j.items?.length ?? 0}`);
  }

  async function syncFromApify() {
    if (!token) return;
    setSelected(null);
    setVariants([]);
    setGenMeta(null);

    pushLog("sync: fetching…");
    const r = await authedFetch(token, "/api/sync", { method: "POST" });
    const j = await r.json();
    if (!r.ok) {
      pushLog(`sync error: ${j.error ?? "unknown"}`);
      toast.error("Sync failed");
      return;
    }
    pushLog(`sync: upserting…`);
    pushLog(`done: inserted ${j.inserted}, updated ${j.updated} (fetched ${j.fetched})`);
    toast.success(`Synced: +${j.inserted} new`);
    await refreshFeed();
  }

  async function generate() {
    if (!token) return;
    if (!selected) {
      toast("Select a post first");
      return;
    }
    if (credits < 1) {
      toast.error("No credits. Use Get Credit or Share.");
      return;
    }

    setVariants([]);
    setGenMeta(null);

    pushLog(`gen: starting (${variantCount} variants)…`);

    const r = await authedFetch(token, "/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tweetId: selected.tweetId,
        stylePreset,
        length,
        variantCount,
        creditOnInfo,
      }),
    });

    const j = await r.json();
    if (!r.ok) {
      pushLog(`gen error: ${j.error ?? "unknown"}`);
      toast.error(j.error ?? "Generate failed");
      // refresh credits
      const me = await authedFetch(token, "/api/auth/me");
      const mj = await me.json();
      if (me.ok) setCredits(mj.credits ?? credits);
      return;
    }

    setVariants(j.variants ?? []);
    setGenMeta({ category: j.category, confidence: j.confidence });

    setCredits((c) => Math.max(0, c - 1));
    pushLog(`gen: done (${(j.variants ?? []).length})`);
  }

  async function copyText(text: string) {
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  }

  async function postDirectly(text: string) {
    try {
      const result = await sdk.actions.composeCast({
        text,
        embeds: [APP_URL],
      });
      if (!result) {
        toast("Canceled");
        return;
      }
      toast.success("Composer opened");
    } catch {
      toast.error("Post failed");
    }
  }

  async function shareForCredits() {
    if (!token) return;
    try {
      const result = await sdk.actions.composeCast({
        text: "Built something on Base? Here’s a terminal-style post generator that turns your X feed into fresh casts ⚡",
        embeds: [APP_URL],
      });
      if (!result) return;

      pushLog("share: verifying daily reward…");
      const r = await authedFetch(token, "/api/credits/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ castHash: (result as any)?.cast?.hash ?? null }),
      });
      const j = await r.json();
      if (r.ok) {
        setCredits(j.credits ?? credits);
        if (j.alreadyClaimed) toast("Already claimed today");
        else toast.success("+2 credits (daily)");
      } else {
        toast.error(j.error ?? "Share reward failed");
      }
    } catch {
      toast.error("Share failed");
    }
  }

  async function getCreditViaContract() {
    if (!token) return;

    try {
      pushLog("credit: preparing contract execution…");
      const provider = await sdk.wallet.getEthereumProvider();
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const from = accounts?.[0];
      if (!from) throw new Error("no_account");

      let chainId = (await provider.request({ method: "eth_chainId" })) as string;
      if (chainId !== BASE_MAINNET_CHAIN_ID_HEX) {
        try {
          await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_MAINNET_CHAIN_ID_HEX }] });
          chainId = BASE_MAINNET_CHAIN_ID_HEX;
        } catch {
          toast.error("Please switch to Base Mainnet in your wallet.");
          return;
        }
      }

      // Small pre-txn animation so it doesn't feel dead
      pushLog("credit: animating…");
      await new Promise((r) => setTimeout(r, 1100));

      const data = encodeCreditLogAction("CREDIT_EARN", "0x");

      pushLog("credit: confirm in wallet…");
      const txHash = (await provider.request({
        method: "eth_sendTransaction",
        params: [{ from, to: CREDIT_CONTRACT, data, value: "0x0" }],
      })) as string;

      pushLog(`credit: sent ${txHash.slice(0, 10)}… verifying…`);

      const vr = await authedFetch(token, "/api/credits/earn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash, wallet: from }),
      });
      const vj = await vr.json();
      if (!vr.ok) {
        pushLog(`credit verify error: ${vj.error ?? "unknown"}`);
        toast.error(vj.error ?? "Verify failed");
        return;
      }
      setCredits(vj.credits ?? credits);
      pushLog("credit: +1");
      toast.success("+1 credit");
    } catch (e: any) {
      if (e?.code === 4001) toast("Canceled");
      else toast.error("Credit txn failed");
      pushLog("credit: failed");
    }
  }

  async function enableNotifications() {
    try {
      pushLog("notifications: add mini app…");
      await sdk.actions.addMiniApp();
      pushLog("notifications: if you enabled notifications, tokens will sync via webhook ✅");
      toast.success("Added / enabled (if prompted)");
    } catch {
      toast.error("Notification enable failed");
    }
  }

  const topBar = (
    <div className="flex items-center gap-2">
      <Badge tone="cyan">{userLabel || "…"}</Badge>
      <Badge tone={credits > 0 ? "green" : "red"}>{credits} credits</Badge>
    </div>
  );

  if (isMiniApp === false) {
    return (
      <div className="min-h-screen px-4 py-10">
        <div className="mx-auto max-w-xl terminal-border rounded-2xl p-5">
          <div className="text-lg font-semibold">Mini App only</div>
          <p className="mt-2 text-sm text-slate-300">
            This app is built to run <b>only</b> inside Farcaster as a Mini App (no browser mode / no address bar).
          </p>
          <div className="mt-4 text-xs text-slate-400">
            Open it from a Farcaster client or Base Build preview.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-3 py-4 md:px-6 md:py-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <div className="text-lg md:text-2xl font-semibold tracking-tight">
                Base Post Generator <span className="text-cyan-300/80">_</span>
                <span className="inline-block h-[1em] w-[0.55em] translate-y-[2px] bg-cyan-300/70 align-middle animate-blink" />
              </div>
            </div>
            <div className="text-xs md:text-sm text-slate-400">Terminal-themed rewrite engine for your Apify X stream</div>
          </div>
          {topBar}
        </div>

        <div className="grid gap-3 md:gap-4 md:grid-cols-12">
          {/* COMMANDS */}
          <div className="md:col-span-3">
            <Panel
              title="COMMANDS"
              right={<span className="text-[11px] text-slate-400">{ready ? "online" : "…"}</span>}
              className="h-full"
            >
              <div className="grid gap-2">
                <button className="btn btn-primary" onClick={syncFromApify} disabled={!token}>
                  SYNC FROM APIFY
                </button>

                <button className="btn" onClick={refreshFeed} disabled={!token}>
                  Refresh feed
                </button>

                <Divider />

                <button className="btn btn-primary" onClick={getCreditViaContract} disabled={!token}>
                  Get Credit (+1)
                </button>

                <button className="btn" onClick={shareForCredits} disabled={!token}>
                  Share for 2 credit (daily)
                </button>

                <button className="btn" onClick={enableNotifications}>
                  Enable notifications
                </button>

                <button className="btn" onClick={() => setTipOpen(true)}>
                  Tip (USDC)
                </button>

                <Divider />

                <SmallLabel>Filters</SmallLabel>

                <label className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-slate-200">Base-only</span>
                  <input type="checkbox" checked={baseOnly} onChange={(e) => setBaseOnly(e.target.checked)} />
                </label>

                <label className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-slate-200">Include replies/retweets</span>
                  <input type="checkbox" checked={includeReplies} onChange={(e) => setIncludeReplies(e.target.checked)} />
                </label>

                <input className="input" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />

                <Divider />

                <SmallLabel>Terminal log</SmallLabel>
                <div ref={logRef} className="h-44 md:h-64 overflow-auto rounded-xl border border-slate-700/30 bg-black/30 p-2 text-xs leading-5">
                  {logs.map((l, i) => (
                    <div key={i} className="text-slate-200">
                      <span className="text-cyan-300/80">$</span> {l}
                    </div>
                  ))}
                </div>
              </div>
            </Panel>
          </div>

          {/* FEED */}
          <div className="md:col-span-5">
            <Panel title="FEED (Latest 50 priority)">
              <div className="text-xs text-slate-400 mb-2">Newest first. Click a row to preview + generate.</div>

              <div className="max-h-[52vh] md:max-h-[70vh] overflow-auto rounded-2xl border border-slate-700/30">
                {feed.length === 0 ? (
                  <div className="p-4 text-sm text-slate-300">No items yet. Hit <span className="text-cyan-200">SYNC</span>.</div>
                ) : (
                  <div className="divide-y divide-slate-700/30">
                    {feed.map((p) => {
                      const active = selected?.tweetId === p.tweetId;
                      return (
                        <button
                          key={p.tweetId}
                          className={
                            "w-full text-left px-3 py-3 transition " +
                            (active ? "bg-cyan-400/10" : "hover:bg-white/5")
                          }
                          onClick={() => {
                            setSelected(p);
                            setVariants([]);
                            setGenMeta(null);
                          }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs text-slate-400">{timeAgo(p.timestamp)} • <span className="text-cyan-200">@{p.handle}</span></div>
                            <div className="flex items-center gap-2 text-[11px] text-slate-400">
                              <span>♥ {p.likes}</span>
                              <span>↻ {p.reposts}</span>
                              <span>↩ {p.replies}</span>
                              <span>👁 {p.views}</span>
                            </div>
                          </div>
                          <div className="mt-1 text-sm text-slate-200">{clampText(p.text)}</div>
                          <div className="mt-1 text-[11px] text-slate-500">{p.url ? p.url : "no url"}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <Divider />

              <div className="grid gap-2">
                <SmallLabel>Generate controls</SmallLabel>
                <div className="grid grid-cols-2 gap-2">
                  <select className="input" value={stylePreset} onChange={(e) => setStylePreset(e.target.value as any)}>
                    {STYLE_PRESETS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>

                  <select className="input" value={length} onChange={(e) => setLength(e.target.value as any)}>
                    <option value="short">short</option>
                    <option value="medium">medium</option>
                    <option value="long">long</option>
                  </select>

                  <select className="input" value={variantCount} onChange={(e) => setVariantCount(Number(e.target.value) as any)}>
                    <option value={3}>3 variants</option>
                    <option value={5}>5 variants</option>
                    <option value={10}>10 variants</option>
                  </select>

                  <label className="flex items-center gap-2 rounded-xl border border-slate-700/30 bg-black/20 px-3 py-2 text-sm">
                    <input type="checkbox" checked={creditOnInfo} onChange={(e) => setCreditOnInfo(e.target.checked)} />
                    <span className="text-slate-200">Credit on INFO posts</span>
                  </label>
                </div>

                <button className="btn btn-primary" onClick={generate} disabled={!token || !selected}>
                  GENERATE (cost: 1 credit)
                </button>
              </div>
            </Panel>
          </div>

          {/* OUTPUT */}
          <div className="md:col-span-4">
            <Panel
              title="OUTPUT"
              right={
                genMeta?.category ? (
                  <div className="flex items-center gap-2">
                    <Badge tone="slate">{genMeta.category}</Badge>
                    <Badge tone={genMeta.confidence === "HIGH" ? "green" : "red"}>{genMeta.confidence}</Badge>
                  </div>
                ) : (
                  <span className="text-[11px] text-slate-400">—</span>
                )
              }
            >
              {variants.length === 0 ? (
                <div className="text-sm text-slate-300">
                  Select a feed item, then generate variants. Each output is original (overlap-guarded).
                </div>
              ) : (
                <div className="grid gap-3">
                  {variants.map((v) => (
                    <FadeIn key={v.id}>
                      <div className="terminal-border rounded-2xl p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Badge tone="cyan">{v.stylePreset}</Badge>
                            <Badge tone="slate">{v.category}</Badge>
                            <Badge tone={v.confidence === "HIGH" ? "green" : "red"}>conf: {v.confidence}</Badge>
                          </div>
                          <div className="text-[11px] text-slate-400">{v.angle}</div>
                        </div>

                        <Divider />

                        <div className="whitespace-pre-wrap text-sm leading-6 text-slate-100">{v.text}</div>

                        <Divider />

                        <div className="flex flex-wrap gap-2">
                          <button className="btn btn-primary" onClick={() => copyText(v.text)}>
                            Copy
                          </button>
                          <button className="btn" onClick={() => postDirectly(v.text)}>
                            Post directly
                          </button>
                        </div>
                      </div>
                    </FadeIn>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </div>
      </div>

      <TipSheet open={tipOpen} onClose={() => setTipOpen(false)} />
    </div>
  );
}
