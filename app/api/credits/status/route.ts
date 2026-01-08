import { NextResponse } from "next/server";
import { z } from "zod";
import { getOrInitCredits, canDailyShare } from "@/lib/credits";
import { utcDateString } from "@/lib/text";

const Body = z.object({ userId: z.string().min(1) });

export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());
    const credits = await getOrInitCredits(body.userId);
    const share = await canDailyShare(body.userId);
    return NextResponse.json({
      userId: body.userId,
      credits,
      lastShareDate: share.last,
      todayUtc: utcDateString(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Bad request" }, { status: 400 });
  }
}
