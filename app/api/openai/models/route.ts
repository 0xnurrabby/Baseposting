import { NextResponse } from "next/server";
import OpenAI from "openai";

export async function POST(req: Request) {
  try {
    const { apiKey } = await req.json();
    if (!apiKey || typeof apiKey !== "string") {
      return NextResponse.json({ error: "Missing apiKey" }, { status: 400 });
    }

    const client = new OpenAI({ apiKey });
    const models = await client.models.list();
    // Normalize to { id }
    const list = (models.data || []).map((m) => ({ id: m.id }));

    return NextResponse.json({ models: list });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to list models" },
      { status: 500 }
    );
  }
}
