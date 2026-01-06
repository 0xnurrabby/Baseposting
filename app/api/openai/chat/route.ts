import { NextResponse } from "next/server";
import OpenAI from "openai";

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

    const client = new OpenAI({ apiKey });

    const input = messages.map((m) => ({
      role: m.role,
      content: [{ type: "input_text" as const, text: m.content }],
    }));

    const resp = await client.responses.create({
      model,
      input,
      temperature: typeof temperature === "number" ? temperature : undefined,
    });

    const latencyMs = Date.now() - t0;
    const outputText = resp.output_text ?? "";

    const usage = (resp as any).usage || null; // includes input_tokens, output_tokens when available

    return NextResponse.json({ latencyMs, outputText, usage, raw: resp });
  } catch (e: any) {
    const latencyMs = Date.now() - t0;
    return NextResponse.json(
      { latencyMs, error: e?.message || "OpenAI chat failed" },
      { status: 500 }
    );
  }
}
