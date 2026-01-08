import { NextResponse } from "next/server";
import { dailyShareStatus, getCredits } from "@/lib/credits";

export const runtime = "nodejs";

function getUserId(req: Request): string {
  const userId = req.headers.get("x-user-id");
  if (!userId) throw new Error("Missing x-user-id");
  return userId;
}

export async function GET(req: Request) {
  try {
    const userId = getUserId(req);
    const credits = await getCredits(userId);
    const { used } = await dailyShareStatus(userId);
    return NextResponse.json({ credits, dailyShareUsed: used, userId }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 400 });
  }
}
