import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { apiKey } = await req.json();
    if (!apiKey || typeof apiKey !== "string") {
      return NextResponse.json({ error: "Missing apiKey" }, { status: 400 });
    }

    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await r.json();
    if (!r.ok) {
      return NextResponse.json({ error: data }, { status: 500 });
    }

    const models = (data?.models || []).map((m: any) => {
      const full = m?.name || "";
      const id = full.startsWith("models/") ? full.slice("models/".length) : full;
      return {
        id,
        supportedActions: m?.supportedGenerationMethods || m?.supported_actions || m?.supportedActions || null,
      };
    });

    return NextResponse.json({ models });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to list models" }, { status: 500 });
  }
}
