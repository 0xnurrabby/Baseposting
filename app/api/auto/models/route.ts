import { NextResponse } from "next/server";

const DEFAULT_CANDIDATES: string[] = [
  // OpenAI
  "https://api.openai.com/v1",
  // OpenAI-compatible aggregators/providers
  "https://openrouter.ai/api/v1",
  "https://api.together.xyz/v1",
  "https://api.groq.com/openai/v1",
];

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
    const { apiKey, baseUrlHint } = await req.json();

    if (!apiKey || typeof apiKey !== "string") {
      return NextResponse.json({ error: "Missing apiKey" }, { status: 400 });
    }

    const candidates = [
      ...(baseUrlHint && typeof baseUrlHint === "string" && baseUrlHint.trim() ? [baseUrlHint.trim()] : []),
      ...DEFAULT_CANDIDATES,
    ];

    const tried: any[] = [];

    for (const baseUrl of candidates) {
      const url = baseUrl.replace(/\/+$/, "") + "/models";

      try {
        const r = await fetchWithTimeout(
          url,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
          },
          6000
        );

        const json = await r.json().catch(() => null);
        tried.push({ baseUrl, status: r.status });

        if (!r.ok) continue;

        const data = (json?.data || json?.models || []) as any[];
        const models = data
          .map((m) => ({ id: m?.id || m?.name || "" }))
          .filter((m) => typeof m.id === "string" && m.id.length > 0);

        if (models.length === 0) continue;

        return NextResponse.json({ baseUrl, models, tried });
      } catch (e: any) {
        tried.push({ baseUrl, error: e?.message || "fetch failed" });
      }
    }

    return NextResponse.json(
      {
        error: "No compatible endpoint found for this key.",
        hint:
          "This tool can auto-detect common OpenAI-compatible endpoints, but an API key alone is not enough if the service uses a different base URL. Paste the correct Base URL (if you have it) and try again.",
        tried,
      },
      { status: 400 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to auto-detect" }, { status: 500 });
  }
}