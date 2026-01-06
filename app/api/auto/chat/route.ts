import { NextResponse } from "next/server";

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: controller.signal });
    return r;
  } finally {
    clearTimeout(id);
  }
}

export async function POST(req: Request) {
  try {
    const { apiKey, baseUrl, model, messages, temperature } = await req.json();

    if (!apiKey || typeof apiKey !== "string") {
      return NextResponse.json({ error: "Missing apiKey" }, { status: 400 });
    }
    if (!baseUrl || typeof baseUrl !== "string") {
      return NextResponse.json({ error: "Missing baseUrl (run 'Test Key & Load' first)" }, { status: 400 });
    }
    if (!model || typeof model !== "string") {
      return NextResponse.json({ error: "Missing model" }, { status: 400 });
    }

    const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";

    const t0 = Date.now();
    const r = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: typeof temperature === "number" ? temperature : 0.2,
        }),
      },
      60000
    );

    const data = await r.json().catch(() => null);
    const latencyMs = Date.now() - t0;

    if (!r.ok) {
      return NextResponse.json({ error: data || { status: r.status }, latencyMs }, { status: 500 });
    }

    const outputText =
      data?.choices?.[0]?.message?.content ??
      data?.choices?.[0]?.delta?.content ??
      data?.choices?.[0]?.text ??
      "";

    return NextResponse.json({ latencyMs, outputText, raw: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Auto chat failed" }, { status: 500 });
  }
}