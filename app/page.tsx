"use client";

import { useEffect, useMemo, useState } from "react";

type Provider = "openai" | "gemini" | "auto";
type ChatRole = "system" | "user" | "assistant";

type ModelItem = { id: string; supportedActions?: any };

const LS_KEY = "llm-api-checker.keys.v1";

function safeJsonParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export default function Home() {
  const [provider, setProvider] = useState<Provider>("openai");
  const [remember, setRemember] = useState(true);

  const [openaiKey, setOpenaiKey] = useState<string>("");
  const [geminiKey, setGeminiKey] = useState<string>("");
  const [autoKey, setAutoKey] = useState<string>("");
  const [autoBaseUrl, setAutoBaseUrl] = useState<string>("");

  const apiKey = provider === "openai" ? openaiKey : provider === "gemini" ? geminiKey : autoKey;

  const [models, setModels] = useState<ModelItem[]>([]);
  const [model, setModel] = useState<string>("");

  const [tab, setTab] = useState<"chat" | "image" | "benchmark">("chat");

  const [temperature, setTemperature] = useState<number>(0.2);

  const [messages, setMessages] = useState<{ role: ChatRole; content: string }[]>([
    { role: "system", content: "You are a helpful assistant. Keep answers concise." },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);

  const [lastCall, setLastCall] = useState<any>(null);

  // Image
  const [imagePrompt, setImagePrompt] = useState("A cute capybara wearing sunglasses, studio lighting");
  const [imageBusy, setImageBusy] = useState(false);
  const [imageB64, setImageB64] = useState<string | null>(null);
  const [geminiImageModel, setGeminiImageModel] = useState("imagen-3.0-generate-001");
  const [openaiImageSize, setOpenaiImageSize] = useState("1024x1024");

  // Benchmark
  const [benchBusy, setBenchBusy] = useState(false);
  const [benchRuns, setBenchRuns] = useState(1);
  const [bench, setBench] = useState<any>(null);

  useEffect(() => {
    const saved = safeJsonParse<Record<string, string>>(localStorage.getItem(LS_KEY) || "");
    if (saved) {
      setOpenaiKey(saved.openai || "");
      setGeminiKey(saved.gemini || "");
      setAutoKey(saved.auto || "");
      setAutoBaseUrl(saved.autoBaseUrl || "");
    }
  }, []);

  useEffect(() => {
    if (!remember) return;
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ openai: openaiKey, gemini: geminiKey, auto: autoKey, autoBaseUrl })
    );
  }, [openaiKey, geminiKey, autoKey, autoBaseUrl, remember]);

  useEffect(() => {
    // reset model list when switching provider
    setModels([]);
    setModel("");
    setBench(null);
    setLastCall(null);
    if (provider !== "auto") setAutoBaseUrl("");
    setLastCall(null);
  }, [provider]);

  const capabilityBadges = useMemo(() => {
    const base = ["Text chat", "Latency + token metrics", "Benchmark score"];
    if (provider === "openai") {
      base.push("Image generation (gpt-image-1)");
    } else {
      base.push("Image generation (Imagen via :predict)");
    }
    return base;
  }, [provider]);

  async function loadModels() {
    setBench(null);
    setLastCall(null);
    setModels([]);
    setModel("");

    if (!apiKey) {
      alert("Paste API key first.");
      return;
    }

    const url = provider === "openai" ? "/api/openai/models" : provider === "gemini" ? "/api/gemini/models" : "/api/auto/models";
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(provider === "auto" ? { apiKey, baseUrlHint: autoBaseUrl || null } : { apiKey }),
    });
    const data = await r.json();

    if (!r.ok) {
      console.error(data);
      alert("Failed to load models. Check API key.");
      return;
    }

    const list: ModelItem[] = data?.models || [];
    if (provider === "auto" && data?.baseUrl) setAutoBaseUrl(data.baseUrl);

    setModels(list);
    if (list[0]?.id) setModel(list[0].id);
  }

  async function sendChat() {
    if (!apiKey || !model) {
      alert("Set API key and model first.");
      return;
    }
    if (provider === "auto" && !autoBaseUrl) {
      alert("Click \"Test Key & Load\" first so the app can discover the correct Base URL.");
      return;
    }
    if (!chatInput.trim()) return;

    setChatBusy(true);
    setBench(null);

    const next = [...messages, { role: "user" as const, content: chatInput.trim() }];
    setMessages(next);
    setChatInput("");

    const url = provider === "openai" ? "/api/openai/chat" : provider === "gemini" ? "/api/gemini/chat" : "/api/auto/chat";

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(provider === "auto" ? { apiKey, baseUrl: autoBaseUrl, model, messages: next, temperature } : { apiKey, model, messages: next, temperature }),
    });
    const data = await r.json();
    setLastCall({ provider, model, ...data, at: new Date().toISOString() });

    if (!r.ok) {
      setMessages([...next, { role: "assistant", content: `❌ Error: ${JSON.stringify(data?.error || data)}` }]);
      setChatBusy(false);
      return;
    }

    setMessages([...next, { role: "assistant", content: data?.outputText || "" }]);
    setChatBusy(false);
  }

  async function generateImage() {
    if (provider === "auto") {
      alert("Image generation is not available in Auto mode. Choose OpenAI or Gemini.");
      return;
    }
    if (!apiKey) {
      alert("Paste API key first.");
      return;
    }

    setImageBusy(true);
    setImageB64(null);
    setBench(null);

    const url = provider === "openai" ? "/api/openai/image" : "/api/gemini/image";
    const body =
      provider === "openai"
        ? { apiKey, prompt: imagePrompt, size: openaiImageSize }
        : { apiKey, prompt: imagePrompt, model: geminiImageModel, sampleCount: 1 };

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await r.json();
    setLastCall({ provider, kind: "image", ...data, at: new Date().toISOString() });

    if (!r.ok) {
      alert(`Image failed: ${JSON.stringify(data?.error || data)}`);
      setImageBusy(false);
      return;
    }

    setImageB64(data?.b64 || null);
    setImageBusy(false);
  }

  async function runBenchmark() {
    if (provider === "auto") {
      alert("Benchmark is disabled in Auto mode. Choose OpenAI or Gemini, or use Chat in Auto mode.");
      return;
    }
    if (!apiKey || !model) {
      alert("Set API key and model first.");
      return;
    }
    if (provider === "auto" && !autoBaseUrl) {
      alert("Click \"Test Key & Load\" first so the app can discover the correct Base URL.");
      return;
    }

    setBenchBusy(true);
    setBench(null);

    const url = provider === "openai" ? "/api/openai/benchmark" : "/api/gemini/benchmark";
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, model, runsPerTest: Math.max(1, benchRuns), temperature }),
    });
    const data = await r.json();

    if (!r.ok) {
      alert(`Benchmark failed: ${JSON.stringify(data?.error || data)}`);
      setBenchBusy(false);
      return;
    }

    setBench(data);
    setBenchBusy(false);
  }

  return (
    <div className="container">
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0 }}>LLM API Checker</h1>
          <div className="small">OpenAI + Gemini | Chat + Image + Benchmark</div>
        </div>
        <div className="small">Local app (your key stays on your machine)</div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="row">
          <div>
            <label>Provider</label>
            <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
              <option value="openai">OpenAI</option>
              <option value="gemini">Gemini</option>
              <option value="auto">Auto (OpenAI‑compatible)</option>
            </select>
          </div>

          <div style={{ minWidth: 320, flex: 1 }}>
            <label>API Key</label>
            <input
              value={provider === "openai" ? openaiKey : provider === "gemini" ? geminiKey : autoKey}
              onChange={(e) =>
                provider === "openai"
                  ? setOpenaiKey(e.target.value)
                  : provider === "gemini"
                  ? setGeminiKey(e.target.value)
                  : setAutoKey(e.target.value)
              }
              placeholder={provider === "openai" ? "sk-..." : provider === "gemini" ? "AIza..." : "Paste any key"}
              spellCheck={false}
            />
            <div className="small" style={{ marginTop: 6 }}>
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                style={{ marginRight: 6 }}
              />
              Remember in browser (localStorage)
            </div>
          </div>


          {provider === "auto" && (
            <div style={{ minWidth: 320, flex: 1 }}>
              <label>Base URL (optional)</label>
              <input
                value={autoBaseUrl}
                onChange={(e) => setAutoBaseUrl(e.target.value)}
                placeholder="Leave blank to auto-try common OpenAI-compatible endpoints"
                spellCheck={false}
              />
              <div className="small" style={{ marginTop: 6 }}>
                If this 3rd‑party key needs a specific endpoint, paste it here (e.g., an OpenAI‑compatible base URL).
              </div>
            </div>
          )}


          <div>
            <label>Models</label>
            <div className="row" style={{ alignItems: "center" }}>
              <button onClick={loadModels}>Test Key & Load</button>
              <select value={model} onChange={(e) => setModel(e.target.value)} style={{ minWidth: 260 }}>
                <option value="">Select model</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <hr />

        <div>
          {capabilityBadges.map((b) => (
            <span className="badge" key={b}>
              {b}
            </span>
          ))}
        </div>

        {provider === "gemini" && model ? (
          <div className="small" style={{ marginTop: 8 }}>
            Tip: Some Gemini models are text-only. Imagen models are used in the Image tab.
          </div>
        ) : null}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="tabs">
          <button className={`tab ${tab === "chat" ? "active" : ""}`} onClick={() => setTab("chat")}>
            Chat
          </button>
          <button className={`tab ${tab === "image" ? "active" : ""}`} onClick={() => setTab("image")}>
            Image
          </button>
          <button
            className={`tab ${tab === "benchmark" ? "active" : ""}`}
            onClick={() => setTab("benchmark")}
          >
            Benchmark
          </button>
        </div>

        <hr />

        {tab === "chat" ? (
          <div className="grid2">
            <div>
              <div className="chatLog">
                {messages
                  .filter((m) => m.role !== "system")
                  .map((m, idx) => (
                    <div key={idx} className={`msg ${m.role === "user" ? "user" : "assistant"}`}>
                      <div className="small" style={{ marginBottom: 6 }}>
                        {m.role}
                      </div>
                      <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
                    </div>
                  ))}
              </div>

              <div className="row" style={{ marginTop: 10, alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <label>Message</label>
                  <textarea value={chatInput} onChange={(e) => setChatInput(e.target.value)} />
                </div>
                <div>
                  <label>Temp</label>
                  <input
                    type="number"
                    value={temperature}
                    step={0.1}
                    min={0}
                    max={2}
                    onChange={(e) => setTemperature(Number(e.target.value))}
                    style={{ width: 90 }}
                  />
                </div>
                <div>
                  <label>&nbsp;</label>
                  <button disabled={chatBusy || !apiKey || !model} onClick={sendChat}>
                    {chatBusy ? "Sending..." : "Send"}
                  </button>
                </div>
              </div>

              <div className="small" style={{ marginTop: 10 }}>
                You can test: coding prompts, JSON output, reasoning, etc.
              </div>
            </div>

            <div>
              <h3 style={{ marginTop: 0 }}>Last Call</h3>
              <div className="small">Latency, tokens, and raw response</div>
              <pre>{lastCall ? JSON.stringify(lastCall, null, 2) : "No calls yet"}</pre>

              <hr />

              <h3 style={{ marginTop: 0 }}>System Prompt</h3>
              <textarea
                value={messages.find((m) => m.role === "system")?.content || ""}
                onChange={(e) => {
                  const sys = e.target.value;
                  setMessages((prev) => {
                    const others = prev.filter((m) => m.role !== "system");
                    return [{ role: "system", content: sys }, ...others];
                  });
                }}
              />
            </div>
          </div>
        ) : null}

        {tab === "image" ? (
          <div className="grid2">
            <div>
              <div>
                <label>Prompt</label>
                <textarea value={imagePrompt} onChange={(e) => setImagePrompt(e.target.value)} />
              </div>

              <div className="row" style={{ marginTop: 10, alignItems: "flex-end" }}>
                {provider === "openai" ? (
                  <div>
                    <label>Size</label>
                    <select value={openaiImageSize} onChange={(e) => setOpenaiImageSize(e.target.value)}>
                      <option value="1024x1024">1024x1024</option>
                      <option value="1024x1536">1024x1536</option>
                      <option value="1536x1024">1536x1024</option>
                    </select>
                  </div>
                ) : (
                  <div style={{ minWidth: 260 }}>
                    <label>Imagen model</label>
                    <input value={geminiImageModel} onChange={(e) => setGeminiImageModel(e.target.value)} />
                    <div className="small" style={{ marginTop: 6 }}>
                      Example: imagen-3.0-generate-001
                    </div>
                  </div>
                )}

                <div>
                  <label>&nbsp;</label>
                  <button disabled={imageBusy || !apiKey} onClick={generateImage}>
                    {imageBusy ? "Generating..." : "Generate"}
                  </button>
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                {imageB64 ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt="Generated"
                    src={`data:image/png;base64,${imageB64}`}
                    style={{ width: "100%", maxWidth: 720, borderRadius: 12, border: "1px solid #e5e7eb" }}
                  />
                ) : (
                  <div className="small">No image yet.</div>
                )}
              </div>
            </div>

            <div>
              <h3 style={{ marginTop: 0 }}>Last Call</h3>
              <pre>{lastCall ? JSON.stringify(lastCall, null, 2) : "No calls yet"}</pre>
              <hr />
              <div className="small">
                If Gemini image fails, try a different Imagen model name (depends on your account/region).
              </div>
            </div>
          </div>
        ) : null}

        {tab === "benchmark" ? (
          <div className="grid2">
            <div>
              <div className="row" style={{ alignItems: "flex-end" }}>
                <div>
                  <label>Runs per test</label>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={benchRuns}
                    onChange={(e) => setBenchRuns(Number(e.target.value))}
                    style={{ width: 110 }}
                  />
                </div>
                <div>
                  <label>Temperature</label>
                  <input
                    type="number"
                    value={temperature}
                    step={0.1}
                    min={0}
                    max={2}
                    onChange={(e) => setTemperature(Number(e.target.value))}
                    style={{ width: 110 }}
                  />
                </div>
                <div>
                  <label>&nbsp;</label>
                  <button disabled={benchBusy || !apiKey || !model} onClick={runBenchmark}>
                    {benchBusy ? "Running..." : "Run Benchmark"}
                  </button>
                </div>
              </div>

              <div className="small" style={{ marginTop: 10 }}>
                This benchmark runs 5 small tests (JSON strictness, instruction following, and code output). It returns a
                simple 0–100 score.
              </div>

              <hr />

              {bench ? (
                <>
                  <h3 style={{ marginTop: 0 }}>Summary</h3>
                  <pre>{JSON.stringify(bench.summary, null, 2)}</pre>
                  <h3>Per test</h3>
                  <pre>{JSON.stringify(bench.results, null, 2)}</pre>
                </>
              ) : (
                <div className="small">No benchmark yet.</div>
              )}
            </div>

            <div>
              <h3 style={{ marginTop: 0 }}>What the score means</h3>
              <div className="small">
                Score is an approximate blend of:
                <ul>
                  <li>Reliability (success rate)</li>
                  <li>Quality pass rate (simple rules)</li>
                  <li>Latency (p95 lower = better)</li>
                  <li>Token usage (lower = better for small tests)</li>
                </ul>
                For real evaluation, expand the prompt suite and add task-specific unit tests.
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="small" style={{ marginTop: 12 }}>
        ✅ Tip: Start by clicking <b>Test Key & Load</b>, then pick a model, then try Chat / Image / Benchmark.
      </div>
    </div>
  );
}
