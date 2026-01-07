import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import { prisma } from "../../lib/db";
import { requireUser } from "../../lib/auth";
import { classify, confidence, diceSimilarity, has7WordOverlap, normalizeText } from "../../lib/text";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

const GenerateBodySchema = z.object({
  tweetId: z.string().min(3),
  stylePreset: z.string().min(2),
  length: z.enum(["short", "medium", "long"]),
  variantCount: z.number().int().min(1).max(10),
  creditOnInfo: z.boolean(),
});

const ANGLE_BANK = [
  "why it matters",
  "how to use it",
  "builder takeaway",
  "mistake to avoid",
  "quick checklist",
  "contrarian take",
  "community question",
];

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function uniqAngles(n: number): string[] {
  const pool = [...ANGLE_BANK];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    if (pool.length === 0) pool.push(...ANGLE_BANK);
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

const VariantsSchema = z.object({
  variants: z.array(
    z.object({
      angle: z.string().min(1),
      text: z.string().min(1),
    })
  ),
});

type Variant = { text: string; angle: string };

async function callOpenAI(args: {
  inputText: string;
  handle: string;
  url?: string | null;
  timestampIso: string;
  stylePreset: string;
  length: "short" | "medium" | "long";
  variantCount: number;
  category: "INFO" | "OPINION" | "MEME";
  confidence: "HIGH" | "LOW";
  creditOnInfo: boolean;
}): Promise<{ variants: Variant[] }> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Use a safe default model
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  const angles = uniqAngles(args.variantCount);

  const styleGuide = (() => {
    switch (args.stylePreset) {
      case "degen":
        return "Degen, punchy, slang-light (not cringe), 1-2 emojis max, no forced hype.";
      case "builder":
        return "Builder voice. Crisp, specific, focused on what to build / how to ship.";
      case "educational":
        return "Clear explainer. Avoid jargon, include 1 actionable takeaway.";
      case "story":
        return "Micro-story vibe. Setup → twist → takeaway.";
      case "thread-ish":
        return "Thread-ish but still single post. Use 3-5 short lines; no numbering.";
      case "checklist":
        return "Checklist style. Short bullets/lines. Concrete steps.";
      case "question-hook":
        return "Open with a strong question hook, then 2-3 lines of context.";
      default:
        return "Clean, modern, confident. No fluff.";
    }
  })();

  const lengthGuide =
    args.length === "short"
      ? "Keep it very short (<= 320 chars)."
      : args.length === "medium"
        ? "Medium length (320-700 chars)."
        : "Long (700-1200 chars), but still readable.";

  const guardrails = [
    "Do NOT copy or paraphrase closely. Absolutely do NOT reuse > 6 consecutive words from the source.",
    "Do NOT quote the source or mention 'the tweet says'.",
    "Do NOT invent facts. If the source is vague/hype, turn it into a neutral prompt or discussion question instead of adding details.",
    "Be original: new hook, new structure, new angle, different wording.",
    "Avoid repeated phrasing across variants; each variant must feel like a different post.",
  ].join("\n");

  const creditRule =
    args.category === "INFO" && args.creditOnInfo
      ? `Append a final standalone line exactly: "source: @${args.handle}"`
      : "Do NOT add any source/credit line.";

  const categoryContext =
    args.category === "INFO"
      ? "This is an INFORMATION/NEWS-type input."
      : args.category === "MEME"
        ? "This is a MEME/light input."
        : "This is an OPINION input.";

  const prompt = [
    "You are generating ORIGINAL Farcaster posts for Base builders.",
    categoryContext,
    `Confidence: ${args.confidence} (do not fabricate beyond confidence).`,
    "",
    "Source (do not copy):",
    `@${args.handle} at ${args.timestampIso}`,
    args.url ? `URL: ${args.url}` : "URL: (none)",
    `TEXT: ${args.inputText}`,
    "",
    "Task:",
    `Generate exactly ${args.variantCount} fresh post variants.`,
    `Each variant must use a DIFFERENT angle from this list, in order: ${angles.join(" | ")}.`,
    `Tone/Style preset: ${args.stylePreset}. Guidance: ${styleGuide}`,
    `Length: ${args.length}. ${lengthGuide}`,
    creditRule,
    "",
    "Formatting rules:",
    "- Output MUST be JSON with {variants:[{angle,text}...]} only.",
    "- Each 'text' must be plain text suitable for a cast (no markdown links).",
    "- No hashtags unless the source had them.",
    "",
    "Guardrails:",
    guardrails,
  ].join("\n");

  // ✅ IMPORTANT: use responses.parse + text.format (NOT response_format)
  const r = await openai.responses.parse({
    model,
    input: [
      { role: "system", content: "You are a careful, high-precision writing assistant." },
      { role: "user", content: prompt },
    ],
    text: {
      format: zodTextFormat(VariantsSchema, "variants_result"),
    },
    temperature: 0.85,
  });

  // parsed output if available, otherwise fallback to output_text json parse
  let parsed: unknown = r.output_parsed;
  if (!parsed) {
    const outText = r.output_text?.trim() ?? "";
    if (!outText) {
      throw new Error("openai_empty_output");
    }
    parsed = JSON.parse(outText);
  }

  const v = VariantsSchema.parse(parsed);

  // enforce count EXACT
  if (v.variants.length !== args.variantCount) {
    throw new Error("openai_wrong_variant_count");
  }

  return { variants: v.variants };
}

function validateVariants(inputText: string, variants: Variant[]) {
  const cleaned = variants.map((v) => ({
    ...v,
    text: v.text.replace(/\s+$/g, "").trim(),
  }));

  // overlap guard
  for (const v of cleaned) {
    if (has7WordOverlap(inputText, v.text)) {
      return { ok: false, reason: "overlap_guard" as const };
    }
    if (normalizeText(v.text).startsWith(normalizeText(inputText).slice(0, 24))) {
      return { ok: false, reason: "too_close" as const };
    }
  }

  // near-duplicate guard across variants
  for (let i = 0; i < cleaned.length; i++) {
    for (let j = i + 1; j < cleaned.length; j++) {
      if (diceSimilarity(cleaned[i].text, cleaned[j].text) > 0.86) {
        return { ok: false, reason: "variants_too_similar" as const };
      }
    }
  }

  return { ok: true as const, cleaned };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const { fid } = await requireUser(req);

    const body = GenerateBodySchema.parse(req.body);
    const rawPost = await prisma.rawPost.findUnique({ where: { tweetId: body.tweetId } });
    if (!rawPost) return res.status(404).json({ error: "post_not_found" });

    // Credit check + spend (1 per generation action)
    const user = await prisma.user.findUnique({ where: { fid } });
    if (!user) return res.status(401).json({ error: "user_missing" });
    if (user.credits < 1) return res.status(402).json({ error: "no_credits" });

    // Spend immediately to prevent race conditions
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.user.findUnique({ where: { fid }, select: { credits: true } });
      if (!fresh || fresh.credits < 1) throw Object.assign(new Error("no_credits"), { statusCode: 402 });
      await tx.user.update({ where: { fid }, data: { credits: { decrement: 1 } } });
      await tx.creditTx.create({ data: { fid, type: "SPEND_GENERATE", delta: -1, meta: { tweetId: body.tweetId } } });
    });

    const category = classify(rawPost.text, rawPost.url);
    const conf = confidence(rawPost.text, rawPost.url);

    let variants: Variant[] = [];
    let attempts = 0;

    while (attempts < 3) {
      attempts++;
      const result = await callOpenAI({
        inputText: rawPost.text,
        handle: rawPost.handle,
        url: rawPost.url,
        timestampIso: rawPost.timestamp.toISOString(),
        stylePreset: body.stylePreset,
        length: body.length,
        variantCount: body.variantCount,
        category,
        confidence: conf,
        creditOnInfo: body.creditOnInfo,
      });

      const v = validateVariants(rawPost.text, result.variants);
      if (v.ok) {
        variants = v.cleaned;
        break;
      }
    }

    if (variants.length === 0) {
      // Refund (best effort) if we couldn't generate valid output
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { fid }, data: { credits: { increment: 1 } } });
        await tx.creditTx.create({ data: { fid, type: "SPEND_GENERATE", delta: +1, meta: { refund: true, tweetId: body.tweetId } } });
      });
      return res.status(500).json({ error: "generation_failed_after_retries" });
    }

    const inputHash = sha256(rawPost.text);
    const created = await prisma.$transaction(async (tx) => {
      const out = [];
      for (let i = 0; i < variants.length; i++) {
        const text = variants[i].text;
        const outputHash = sha256(text);
        const row = await tx.generatedPost.create({
          data: {
            rawPostId: rawPost.id,
            fid,
            stylePreset: body.stylePreset,
            length: body.length,
            variantIdx: i,
            category,
            confidence: conf,
            angle: variants[i].angle,
            text,
            inputHash,
            outputHash,
          },
        });
        out.push(row);
      }
      return out;
    });

    return res.status(200).json({
      category,
      confidence: conf,
      variants: created.map((c) => ({
        id: c.id,
        angle: c.angle,
        text: c.text,
        stylePreset: c.stylePreset,
        length: c.length,
        category: c.category,
        confidence: c.confidence,
      })),
    });
  } catch (e: any) {
    return res.status(e?.statusCode ?? 500).json({ error: e?.message ?? "error" });
  }
}
