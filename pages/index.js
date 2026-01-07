import { useEffect, useMemo, useRef, useState } from "react";
import { sdk } from "@farcaster/miniapp-sdk";

const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const CREDIT_CONTRACT = "0xB331328F506f2D35125e367A190e914B1b6830cF";

const BUILDER_CODE = process.env.NEXT_PUBLIC_BUILDER_CODE || "TODO_REPLACE_BUILDER_CODE";
const RECIPIENT = process.env.NEXT_PUBLIC_TIP_RECIPIENT || "0x0000000000000000000000000000000000000000";

const STYLE_PRESETS = [
  ["degen","degen"],
  ["builder","builder"],
  ["educational","educational"],
  ["story","story"],
  ["thread-ish","thread-ish"],
  ["checklist","checklist"],
  ["question-hook","question-hook"],
];

const LENGTHS = [
  ["short","short"],
  ["medium","medium"],
  ["long","long"],
];

const COUNTS = [3,5,10];

function isHexAddress(a){
  return /^0x[a-fA-F0-9]{40}$/.test(a || "");
}
function isZeroAddress(a){
  return (a || "").toLowerCase() === "0x0000000000000000000000000000000000000000";
}

function formatTime(ts){
  try {
    const d = new Date(ts);
    return d.toISOString().replace("T"," ").slice(0,19)+"Z";
  } catch { return String(ts); }
}
function clip(s, n=120){
  const t = String(s||"").replace(/\s+/g," ").trim();
  return t.length>n ? t.slice(0,n-1)+"…" : t;
}

async function qaFetch(path, opts){
  if (sdk?.quickAuth?.fetch) return sdk.quickAuth.fetch(path, opts);
  return fetch(path, opts);
}

function toastText(err){
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  if (err?.message) return err.message;
  return String(err);
}

function encodeTransfer(to, amountDecimalStr){
  // Selector: a9059cbb
  const selector = "a9059cbb";
  if (!isHexAddress(to) || isZeroAddress(to)) throw new Error("Invalid recipient address");
  const val = Number(amountDecimalStr);
  if (!Number.isFinite(val) || val <= 0) throw new Error("Invalid amount");

  // decimals 6
  const amt = BigInt(Math.round(val * 1_000_000));
  if (amt <= 0n) throw new Error("Invalid amount");

  const toNo0x = to.slice(2).toLowerCase().padStart(64, "0");
  const amtHex = amt.toString(16).padStart(64, "0");
  return "0x" + selector + toNo0x + amtHex;
}

async function getDataSuffix(){
  try{
    const mod = await import("/sdk/attribution.js");
    return mod.buildDataSuffix(BUILDER_CODE);
  } catch {
    return null;
  }
}

async function ensureBaseChain(provider){
  const chainId = await provider.request({ method: "eth_chainId" });
  if (chainId === "0x2105" || chainId === "0x14a34") return chainId;

  try{
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x2105" }],
    });
    return "0x2105";
  } catch (e){
    throw new Error("Please switch to Base Mainnet (0x2105) in your wallet.");
  }
}

async function walletSendCalls({ to, data }){
  const provider = (sdk?.wallet?.getEthereumProvider)
    ? await sdk.wallet.getEthereumProvider()
    : (typeof window !== "undefined" ? window.ethereum : null);
  if (!provider) throw new Error("No wallet provider found in this Mini App.");

  const accounts = await provider.request({ method: "eth_requestAccounts" });
  const from = accounts?.[0];
  if (!from) throw new Error("No account available.");

  const chainId = await ensureBaseChain(provider);
  const dataSuffix = await getDataSuffix();

  const payload = {
    version: "2.0.0",
    from,
    chainId,
    atomicRequired: true,
    calls: [{
      to,
      value: "0x0",
      data
    }],
    capabilities: {
      dataSuffix
    }
  };

  // If builder code missing, disable sending (required rule)
  if (!dataSuffix) {
    throw new Error("Builder code missing. Set NEXT_PUBLIC_BUILDER_CODE to enable sending.");
  }

  const result = await provider.request({
    method: "wallet_sendCalls",
    params: [payload]
  });

  return result;
}

function extractTxHash(sendCallsResult){
  if (!sendCallsResult) return null;
  if (typeof sendCallsResult === "string" && /^0x[a-fA-F0-9]{64}$/.test(sendCallsResult)) return sendCallsResult;
  if (sendCallsResult?.txHash) return sendCallsResult.txHash;
  if (Array.isArray(sendCallsResult?.txHashes) && sendCallsResult.txHashes[0]) return sendCallsResult.txHashes[0];
  if (Array.isArray(sendCallsResult?.transactionHashes) && sendCallsResult.transactionHashes[0]) return sendCallsResult.transactionHashes[0];
  if (Array.isArray(sendCallsResult?.hashes) && sendCallsResult.hashes[0]) return sendCallsResult.hashes[0];
  return null;
}

export default function Home(){
  const [me, setMe] = useState({ fid: null, credits: null, lastShareDate: null });
  const [feed, setFeed] = useState([]);
  const [loadingFeed, setLoadingFeed] = useState(false);

  const [baseOnly, setBaseOnly] = useState(false);
  const [includeRR, setIncludeRR] = useState(false);
  const [search, setSearch] = useState("");

  const [syncLogs, setSyncLogs] = useState([]);
  const [syncBusy, setSyncBusy] = useState(false);

  const [style, setStyle] = useState("builder");
  const [length, setLength] = useState("medium");
  const [variantCount, setVariantCount] = useState(5);
  const [creditOnInfo, setCreditOnInfo] = useState(true);

  const [selected, setSelected] = useState(null);
  const [output, setOutput] = useState({ variants: [], category: null, confidence: null });
  const [genBusy, setGenBusy] = useState(false);

  const [toast, setToast] = useState(null);

  const [tipOpen, setTipOpen] = useState(false);
  const [tipAmount, setTipAmount] = useState("5");
  const [tipState, setTipState] = useState("Send USDC"); // state machine
  const [creditBusy, setCreditBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);

  const toastTimer = useRef(null);
  function showToast(t){
    setToast(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(()=>setToast(null), 2800);
  }

  // Mini App ready
  useEffect(()=>{
    let mounted = true;
    (async ()=>{
      try { await sdk.actions.ready(); } catch {}
      try {
        const r = await qaFetch("/api/me");
        const j = await r.json();
        if (mounted && j?.ok) setMe({ fid: j.fid, credits: j.credits, lastShareDate: j.lastShareDate });
      } catch {}
      await refreshFeed();
    })();
    return ()=>{ mounted=false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshFeed(){
    setLoadingFeed(true);
    try{
      const qs = new URLSearchParams({
        limit: "50",
        baseOnly: String(baseOnly),
        includeRR: String(includeRR),
        search: search.trim()
      });
      const r = await fetch("/api/posts?"+qs.toString());
      const j = await r.json();
      if (j?.ok) setFeed(j.items || []);
    } catch (e){
      showToast("Feed load failed: " + toastText(e));
    } finally{
      setLoadingFeed(false);
    }
  }

  async function doSync(){
    setSyncBusy(true);
    setSyncLogs(["starting sync…"]);
    try{
      const r = await fetch("/api/sync", { method:"POST" });
      const j = await r.json();
      setSyncLogs(j.logs || []);
      if (j?.ok) showToast(`Sync done: +${j.inserted} / ~${j.updated}`);
      await refreshFeed();
    } catch (e){
      showToast("Sync failed: " + toastText(e));
      setSyncLogs((s)=>[...s, "error: "+toastText(e)]);
    } finally{
      setSyncBusy(false);
    }
  }

  async function doGenerate(item){
    setSelected(item);
    setGenBusy(true);
    setOutput({ variants: [], category: null, confidence: null });
    try{
      const r = await qaFetch("/api/generate", {
        method:"POST",
        headers: { "content-type":"application/json" },
        body: JSON.stringify({
          tweetId: item.tweet_id,
          style,
          length,
          variantCount,
          creditOnInfo
        })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Generate failed");
      setOutput({ variants: j.variants || [], category: j.category, confidence: j.confidence });
      setMe((m)=>({ ...m, credits: j.credits ?? m.credits }));
    } catch (e){
      showToast(toastText(e));
    } finally{
      setGenBusy(false);
    }
  }

  async function copyText(t){
    try{
      await navigator.clipboard.writeText(t);
      showToast("Copied");
    } catch {
      showToast("Copy failed");
    }
  }

  async function postDirect(t){
    try{
      if (!sdk?.actions?.composeCast) throw new Error("composeCast not available in this client.");
      await sdk.actions.composeCast({ text: t });
      showToast("Opened composer");
    } catch (e){
      showToast("Post failed: " + toastText(e));
    }
  }

  async function shareForCredit(){
    setShareBusy(true);
    try{
      if (!sdk?.actions?.composeCast) throw new Error("composeCast not available.");
      const text = "I’m using Base Post Generator to turn my feed into fresh posts. Try it:";
      await sdk.actions.composeCast({ text, embeds: ["https://baseposting.online/"] });

      const r = await qaFetch("/api/credits/share", { method:"POST", headers:{ "content-type":"application/json" }, body: "{}" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Share credit failed");
      setMe((m)=>({ ...m, credits: j.credits ?? m.credits }));
      showToast("+2 credits (daily)");
    } catch (e){
      showToast(toastText(e));
    } finally{
      setShareBusy(false);
    }
  }

  async function earnCreditOnchain(){
    setCreditBusy(true);
    try{
      // quick pre-transaction UX animation (required)
      showToast("Preparing credit…");
      await new Promise(r=>setTimeout(r, 1200));

      const result = await walletSendCalls({ to: CREDIT_CONTRACT, data: "0x" });
      const txHash = extractTxHash(result);
      if (!txHash) {
        showToast("Sent. Verify in server…");
      } else {
        showToast("Tx sent. Verifying…");
      }

      const r = await qaFetch("/api/credits/claim", {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body: JSON.stringify({ txHash })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Claim failed");
      setMe((m)=>({ ...m, credits: j.credits ?? m.credits }));
      showToast("+1 credit added");
    } catch (e){
      showToast(toastText(e));
    } finally{
      setCreditBusy(false);
    }
  }

  async function openTip(){
    setTipState("Send USDC");
    setTipOpen(true);
  }

  async function sendTip(){
    try{
      if (!isHexAddress(RECIPIENT) || isZeroAddress(RECIPIENT)) {
        showToast("Tip recipient missing. Set NEXT_PUBLIC_TIP_RECIPIENT.");
        return;
      }
      if (!BUILDER_CODE || BUILDER_CODE === "TODO_REPLACE_BUILDER_CODE") {
        showToast("Builder code missing. Set NEXT_PUBLIC_BUILDER_CODE.");
        return;
      }

      setTipState("Preparing tip…");
      await new Promise(r=>setTimeout(r, 1200)); // required pre-wallet animation

      setTipState("Confirm in wallet");
      const data = encodeTransfer(RECIPIENT, tipAmount);

      const result = await walletSendCalls({ to: USDC_CONTRACT, data });
      setTipState("Sending…");

      // We can't reliably confirm transfer here without RPC; keep UX clean.
      await new Promise(r=>setTimeout(r, 700));
      setTipState("Send again");
      showToast("Tip sent (check wallet)");
      return result;
    } catch (e){
      setTipState("Send USDC");
      showToast(toastText(e));
    }
  }

  const canTip = useMemo(()=>{
    return isHexAddress(RECIPIENT) && !isZeroAddress(RECIPIENT) && BUILDER_CODE !== "TODO_REPLACE_BUILDER_CODE";
  }, []);

  const tipCtaDisabled = tipState !== "Send USDC" && tipState !== "Send again";

  return (
    <div className="app">
      <div className="header">
        <div className="brand">
          <div className="brandDot" />
          <div>
            <div className="title">
              BASE POST GENERATOR<span className="cursor" />
            </div>
            <div className="subtitle">sync → pick → generate → post</div>
          </div>
        </div>

        <div className="headerRight">
          <span className="pill"><strong>FID</strong> {me.fid ?? "—"}</span>
          <span className="pill"><strong>CREDITS</strong> {me.credits ?? "—"}</span>
          <button className="smallBtn" onClick={refreshFeed} disabled={loadingFeed}>Refresh feed</button>
          <button className="smallBtn" onClick={openTip}>Tip</button>
        </div>
      </div>

      <div className="grid">
        {/* COMMANDS */}
        <div className="panel">
          <div className="panelHeader"><h3>COMMANDS</h3><span className="badge">LIVE</span></div>
          <div className="panelBody">
            <div className="stack">
              <button className="cmdBtn" onClick={doSync} disabled={syncBusy}>
                {syncBusy ? "SYNCING…" : "SYNC FROM APIFY"}
              </button>

              <button className="cmdBtn cmdBtnSecondary" onClick={earnCreditOnchain} disabled={creditBusy}>
                {creditBusy ? "GETTING CREDIT…" : "Get Credit (+1 via contract)"}
              </button>

              <button className="cmdBtn cmdBtnSecondary" onClick={shareForCredit} disabled={shareBusy}>
                {shareBusy ? "SHARING…" : "Share for 2 credit (daily)"}
              </button>

              <button className="cmdBtn cmdBtnSecondary" onClick={()=>{
                if (!sdk?.actions?.requestAddFrame) return showToast("Add/Notifications not supported in this client.");
                sdk.actions.requestAddFrame().then(()=>showToast("Requested add/notifications")).catch(e=>showToast(toastText(e)));
              }}>
                Enable notifications
              </button>

              <div className="miniRow"><strong>Tip config</strong></div>
              <div className="miniRow">RECIPIENT: {isHexAddress(RECIPIENT) ? RECIPIENT.slice(0,8)+"…"+RECIPIENT.slice(-6) : "not set"}</div>
              <div className="miniRow">BUILDER_CODE: {BUILDER_CODE === "TODO_REPLACE_BUILDER_CODE" ? "not set" : "set"}</div>

              <div className="miniRow"><strong>Sync log</strong></div>
              <div className="logBox">
                {syncLogs.length ? syncLogs.map((l,idx)=>(
                  <div key={idx} className={"logLine " + (l.startsWith("done") ? "ok" : l.startsWith("error") ? "err" : "")}>
                    {"> "}{l}
                  </div>
                )) : <div className="logLine">{"> ready"}</div>}
              </div>

              <div className="note">
                Every generate consumes 1 credit. New users start with 10 free.
                Credits are earned via onchain contract execution, or daily share bonus.
              </div>
            </div>
          </div>
        </div>

        {/* FEED */}
        <div className="panel">
          <div className="panelHeader">
            <h3>FEED (latest 50)</h3>
            <span className="badge">{loadingFeed ? "loading…" : `${feed.length} items`}</span>
          </div>
          <div className="panelBody">
            <div className="filters">
              <div className="toggleRow">
                <input type="checkbox" checked={baseOnly} onChange={(e)=>setBaseOnly(e.target.checked)} />
                Base-only
              </div>
              <div className="toggleRow">
                <input type="checkbox" checked={includeRR} onChange={(e)=>setIncludeRR(e.target.checked)} />
                Include replies/RT
              </div>
              <input className="input" placeholder="Search… (@handle or text)" value={search} onChange={(e)=>setSearch(e.target.value)} />
              <button className="smallBtn" onClick={refreshFeed} disabled={loadingFeed}>Apply</button>
            </div>

            <div className="feedList">
              {feed.map((it)=>(
                <div key={it.tweet_id} className="feedItem">
                  <div className="feedTop">
                    <div className="handle">{it.handle}</div>
                    <div className="time">{formatTime(it.timestamp)}</div>
                  </div>
                  <div className="preview">{clip(it.text, 170)}</div>
                  <div className="metaRow">
                    <span className="badge">❤ {it.like_count}</span>
                    <span className="badge">↩ {it.reply_count}</span>
                    <span className="badge">🔁 {it.retweet_count}</span>
                    <span className="badge">💬 {it.quote_count}</span>
                    {it.url ? <span className="badge"><a href={it.url} target="_blank" rel="noreferrer">source</a></span> : <span className="badge">no url</span>}
                  </div>

                  <button className="genBtn" onClick={()=>doGenerate(it)} disabled={genBusy}>
                    {genBusy && selected?.tweet_id === it.tweet_id ? "GENERATING…" : "GENERATE"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* OUTPUT */}
        <div className="panel">
          <div className="panelHeader">
            <h3>OUTPUT</h3>
            <span className="badge">{genBusy ? "working…" : output.variants.length ? `${output.variants.length} variants` : "idle"}</span>
          </div>
          <div className="panelBody">
            <div className="outputControls">
              <select className="select" value={style} onChange={(e)=>setStyle(e.target.value)}>
                {STYLE_PRESETS.map(([k,label])=><option key={k} value={k}>{label}</option>)}
              </select>
              <select className="select" value={length} onChange={(e)=>setLength(e.target.value)}>
                {LENGTHS.map(([k,label])=><option key={k} value={k}>{label}</option>)}
              </select>
              <select className="select" value={variantCount} onChange={(e)=>setVariantCount(Number(e.target.value))}>
                {COUNTS.map((c)=><option key={c} value={c}>{c} variants</option>)}
              </select>
              <div className="toggleRow">
                <input type="checkbox" checked={creditOnInfo} onChange={(e)=>setCreditOnInfo(e.target.checked)} />
                Credit on INFO
              </div>
            </div>

            {!selected ? (
              <div className="note">Pick a feed item and hit GENERATE. You’ll get Copy + Post buttons instantly.</div>
            ) : null}

            <div className="outputList">
              {output.variants.map((v, idx)=>(
                <div key={idx} className="card">
                  <div className="cardTop">
                    <div className="labelRow">
                      <span className="label">{style}</span>
                      <span className={"label " + (output.category==="INFO" ? "good" : output.category==="MEME" ? "warn" : "")}>{output.category || "—"}</span>
                      <span className={"label " + (output.confidence==="HIGH" ? "good" : "warn")}>CONF {output.confidence || "—"}</span>
                    </div>
                    <span className="label">#{idx+1}</span>
                  </div>

                  <div className="cardText">{v}</div>

                  <div className="rowBtns">
                    <button className="btn secondary" onClick={()=>copyText(v)}>Copy</button>
                    <button className="btn" onClick={()=>postDirect(v)}>Post</button>
                  </div>
                </div>
              ))}
            </div>

          </div>
        </div>
      </div>

      {toast ? <div className="toast">{toast}</div> : null}

      {tipOpen ? (
        <div className="modalOverlay" onClick={()=>setTipOpen(false)}>
          <div className="sheet" onClick={(e)=>e.stopPropagation()}>
            <div className="sheetHeader">
              <h4>TIP (USDC on Base)</h4>
              <button className="closeX" onClick={()=>setTipOpen(false)}>Close</button>
            </div>

            <div className="presets">
              {["1","5","10","25"].map((x)=>(
                <button key={x} className="preset" onClick={()=>setTipAmount(x)}>${x}</button>
              ))}
            </div>

            <div style={{ marginTop: 10 }}>
              <input className="input" value={tipAmount} onChange={(e)=>setTipAmount(e.target.value)} placeholder="Custom amount (USD)" />
            </div>

            <div className="sheetFooter">
              <button className="primaryCta" onClick={sendTip} disabled={!canTip || tipCtaDisabled}>
                {tipState}
              </button>
            </div>

            <div className="note">
              Required pre-wallet animation is built-in. If Recipient / Builder Code is missing, sending is disabled (by design).
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
