import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const t0 = Date.now();
  try {
    const { apiKey, prompt, model = "imagen-3.0-generate-001", sampleCount = 1 } = (await req.json()) as {
      apiKey: string;
      prompt: string;
      model?: string;
      sampleCount?: number;
    };

    if (!apiKey || typeof apiKey !== "string") {
      return NextResponse.json({ error: "Missing apiKey" }, { status: 400 });
    }
    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }

    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:predict`, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: Math.max(1, Math.min(4, sampleCount || 1)) },
      }),
    });

    const data = await r.json();
    const latencyMs = Date.now() - t0;

    if (!r.ok) {
      return NextResponse.json({ latencyMs, error: data }, { status: 500 });
    }

    const b64 = data?.predictions?.[0]?.bytesBase64Encoded || data?.predictions?.[0]?.bytesBase64 || null;

    return NextResponse.json({ latencyMs, b64, raw: data });
  } catch (e: any) {
    const latencyMs = Date.now() - t0;
    return NextResponse.json(
      { latencyMs, error: e?.message || "Gemini image failed" },
      { status: 500 }
    );
  }
}
