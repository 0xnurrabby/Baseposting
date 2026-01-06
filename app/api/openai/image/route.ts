import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const t0 = Date.now();
  try {
    const { apiKey, prompt, size = "1024x1024" } = (await req.json()) as {
      apiKey: string;
      prompt: string;
      size?: string;
    };

    if (!apiKey || typeof apiKey !== "string") {
      return NextResponse.json({ error: "Missing apiKey" }, { status: 400 });
    }
    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }

    const r = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        size,
        response_format: "b64_json",
      }),
    });

    const data = await r.json();
    const latencyMs = Date.now() - t0;
    if (!r.ok) {
      return NextResponse.json({ latencyMs, error: data }, { status: 500 });
    }

    // data.data[0].b64_json
    const b64 = data?.data?.[0]?.b64_json || null;

    return NextResponse.json({ latencyMs, b64, raw: data });
  } catch (e: any) {
    const latencyMs = Date.now() - t0;
    return NextResponse.json(
      { latencyMs, error: e?.message || "OpenAI image failed" },
      { status: 500 }
    );
  }
}
