import { NextResponse } from "next/server";
import { addCredits, dailyShareStatus, markDailyShareUsed } from "@/lib/credits";

export const runtime = "nodejs";

function getUserId(req: Request): string {
  const userId = req.headers.get("x-user-id");
  if (!userId) throw new Error("Missing x-user-id");
  return userId;
}

export async function POST(req: Request) {
  try {
    const userId = getUserId(req);
    const st = await dailyShareStatus(userId);
    if (st.used) return NextResponse.json({ error: "Daily share already used." }, { status: 429 });

    await markDailyShareUsed(userId);
    const credits = await addCredits(userId, 2);
    return NextResponse.json({ credits }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 400 });
  }
}
