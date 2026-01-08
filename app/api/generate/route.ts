import { NextResponse } from "next/server";
import { fetchLatestPosts } from "@/lib/apify";
import { generateBaseBanger } from "@/lib/openai";
import { pickStyleSeed } from "@/lib/variety";
import { getRecentOpeners, pushRecentOpener, spendCredits } from "@/lib/credits";

export const runtime = "nodejs";

function getUserId(req: Request): string {
  const userId = req.headers.get("x-user-id");
  if (!userId) throw new Error("Missing x-user-id");
  return userId;
}

export async function POST(req: Request) {
  try {
    const userId = getUserId(req);
    const body = await req.json().catch(() => ({}));
    const extraContext = String(body?.extraContext ?? "").slice(0, 400);

    const remaining = await spendCredits(userId, 1);

    const limit = Number(process.env.APIFY_LIMIT ?? "50");
    const scraped = await fetchLatestPosts(Number.isFinite(limit) ? limit : 50);

    const avoidOpenings = await getRecentOpeners(userId);
    const styleSeed = pickStyleSeed();

    const text = await generateBaseBanger({ scraped, extraContext, styleSeed, avoidOpenings });

    const opener = (text.split("\n")[0] ?? "").slice(0, 40);
    await pushRecentOpener(userId, opener);

    return NextResponse.json({ text, credits: remaining }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 400 });
  }
}
