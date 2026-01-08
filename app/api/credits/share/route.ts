import { NextResponse } from "next/server";
import { z } from "zod";
import { markDailyShareAndAward } from "@/lib/credits";
import { utcDateString } from "@/lib/text";

const Body = z.object({ userId: z.string().min(1) });

export async function POST(req: Request) {
  try {
    const { userId } = Body.parse(await req.json());
    const out = await markDailyShareAndAward(userId);
    if (!out.ok) {
      return NextResponse.json({ error: "Daily share already claimed", credits: out.credits, todayUtc: utcDateString() }, { status: 429 });
    }
    return NextResponse.json({ credits: out.credits, todayUtc: out.today });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Bad request" }, { status: 400 });
  }
}
