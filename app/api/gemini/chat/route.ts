import { NextResponse } from "next/server";

type Msg = { role: "system" | "user" | "assistant"; content: string };

export async function POST(req: Request) {
  const t0 = Date.now();
  try {
    const { apiKey, model, messages, temperature } = (await req.json()) as {
      apiKey: string;
      model: string;
      messages: Msg[];
      temperature?: number;
    };

    if (!apiKey || typeof apiKey !== "string") {
      return NextResponse.json({ error: "Missing apiKey" }, { status: 400 });
    }
    if (!model || typeof model !== "string") {
      return NextResponse.json({ error: "Missing model" }, { status: 400 });
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "Missing messages" }, { status: 400 });
    }

    // Gemini uses "contents" with roles: user/model.
    // We'll prepend "system" text to the first user message if provided.
    const systemTexts = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n").trim();
    const nonSystem = messages.filter((m) => m.role !== "system");

    const contents = nonSystem.map((m, idx) => {
      const role = m.role === "assistant" ? "model" : "user";
      let text = m.content;
      if (idx === 0 && role === "user" && systemTexts) {
        text = `${systemTexts}\n\n${text}`;
      }
      return { role, parts: [{ text }] };
    });

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: typeof temperature === "number" ? { temperature } : undefined,
        }),
      }
    );

    const data = await r.json();
    const latencyMs = Date.now() - t0;

    if (!r.ok) {
      return NextResponse.json({ latencyMs, error: data }, { status: 500 });
    }

    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join("") || "";
    const usage = data?.usageMetadata || null;

    return NextResponse.json({ latencyMs, outputText: text, usage, raw: data });
  } catch (e: any) {
    const latencyMs = Date.now() - t0;
    return NextResponse.json(
      { latencyMs, error: e?.message || "Gemini chat failed" },
      { status: 500 }
    );
  }
}
