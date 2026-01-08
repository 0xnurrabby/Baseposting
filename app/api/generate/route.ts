import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchLatestXPosts } from "@/lib/apify";
import { generatePost } from "@/lib/openai";
import { BASE_FACTS } from "@/lib/baseFacts";
import { getHistory, pushHistory, spendCredit, refundCredit } from "@/lib/credits";
import { makeSeed, pickStyle, pickAvoidedOpeners, REPETITION_GUARDS } from "@/lib/variety";
import { clamp, stripControlChars } from "@/lib/text";

const Body = z.object({
  userId: z.string().min(1),
  context: z.string().optional().default(""),
});

export const runtime = "nodejs"; // uses crypto + kv

export async function POST(req: Request) {
  const startedAt = Date.now();
  let userId = "unknown";

  try {
    const body = Body.parse(await req.json());
    userId = body.userId;

    const spend = await spendCredit(userId);
    if (!spend.ok) return NextResponse.json({ error: "Out of credits", credits: spend.credits }, { status: 402 });

    const seed = makeSeed(userId, startedAt);
    const style = pickStyle(seed);
    const avoidOpeners = pickAvoidedOpeners(seed);

    const [posts, history] = await Promise.all([fetchLatestXPosts(), getHistory(userId)]);
    const postSample = posts
      .slice(0, 18)
      .map((p) => {
        const meta = [
          p.author ? `@${p.author}` : null,
          p.likes != null ? `${p.likes} likes` : null,
          p.reposts != null ? `${p.reposts} reposts` : null,
        ]
          .filter(Boolean)
          .join(", ");
        return `- ${meta ? "[" + meta + "] " : ""}${p.text}`;
      })
      .join("\n");

    const system = [
      "You are an expert crypto-twitter copywriter and Base ecosystem builder.",
      "Write ONE final post for X / Farcaster in a human, punchy voice.",
      "Hard rules:",
      "- Must be Base-focused, but do NOT claim concrete facts unless they appear in the source posts or the provided Base facts.",
      "- Do NOT hallucinate product launches, metrics, partnerships, token tickers, or dates.",
      "- Avoid cringe. Emojis OK but tasteful (0-2).",
      "- Avoid these openers: " + avoidOpeners.join(", "),
      "- Avoid these phrases: " + REPETITION_GUARDS.bannedPhrases.join(", "),
      "- Avoid repeating the user's last outputs. If similar, choose a different angle and opening.",
      "- Length: 1-2 short paragraphs, max 260 chars.",
      "",
      "Base facts you may reference (optional):",
      ...BASE_FACTS.map((f) => `- ${f}`),
      "",
      "Style target: " + style,
    ].join("\n");

    const user = [
      "User extra context (optional):",
      stripControlChars(body.context || ""),
      "",
      "Recent source posts (sample):",
      postSample || "- (no source posts available)",
      "",
      "User's last outputs (avoid repeating):",
      history.length ? history.map((h) => `- ${h}`).join("\n") : "- (none)",
      "",
      "Now write the final post. Return ONLY the post text.",
    ].join("\n");

    const text = (await generatePost({ system, user, temperature: 0.95 })).trim();

    // Basic safety/quality checks
    const cleaned = stripControlChars(text)
      .replace(/^["'“”]+|["'“”]+$/g, "")
      .trim();

    if (!cleaned || cleaned.length < 8) throw new Error("Model returned empty text");

    // Store history for anti-repetition
    await pushHistory(userId, clamp(cleaned, 280));

    const sourceHint = posts?.[0]?.author ? `Inspired by latest posts (e.g., @${posts[0].author}).` : "Inspired by latest posts.";
    return NextResponse.json({ text: cleaned, credits: spend.credits, sourceHint });
  } catch (e: any) {
    // Refund if we spent a credit but failed after spending.
    if (userId && userId !== "unknown") {
      try { await refundCredit(userId); } catch {}
    }
    const msg = typeof e?.message === "string" ? e.message : "Bad request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
