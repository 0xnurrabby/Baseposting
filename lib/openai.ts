import { BASE_FACTS } from "@/lib/baseFacts";
import { clampTweet, violatesOpeningBan } from "@/lib/variety";

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

export async function generateBaseBanger(params: {
  scraped: { author?: string; text?: string; createdAt?: string; likeCount?: number; replyCount?: number; retweetCount?: number; quoteCount?: number; url?: string }[];
  extraContext: string;
  styleSeed: string;
  avoidOpenings: string[];
}): Promise<string> {
  const apiKey = mustEnv("OPENAI_API_KEY");
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  const facts = BASE_FACTS.map((f) => `- ${f}`).join("\n");

  const source = params.scraped.slice(0, 8).map((p, i) => {
    const meta = [
      p.author ? `@${p.author}` : null,
      p.createdAt ? `time:${p.createdAt}` : null,
      typeof p.likeCount === "number" ? `likes:${p.likeCount}` : null,
      typeof p.retweetCount === "number" ? `rts:${p.retweetCount}` : null,
      p.url ? `url:${p.url}` : null,
    ].filter(Boolean).join(" | ");
    const txt = (p.text ?? "").replace(/\s+/g, " ").trim();
    return `(${i+1}) ${meta}\n${txt}`;
  }).join("\n\n");

  const system: ChatMsg = {
    role: "system",
    content:
`You are a top-tier crypto social copywriter specializing in the Base ecosystem.
Write ONE short post (max 280 chars). It must feel like a human wrote it (no corporate tone).
Be clever, punchy, natural. Tasteful emojis ok. No cringe.
Hard rules:
- Do not invent Base products, partnerships, launches, metrics, or claims not in the provided facts.
- If you mention Base, keep it aligned with the facts. If not needed, keep it generally onchain/crypto-social but still Base-adjacent.
- Avoid repetitive openings and banned openings.
- No hate, harassment, scams, or policy-violating content. No personal attacks.
- No explicit financial advice. Avoid 'NFA' style disclaimers.
Base facts (only safe source of truth):
${facts}
Style seed: ${params.styleSeed}
Banned openings (avoid starting with these): ${params.avoidOpenings.join(", ")}`
  };

  const user: ChatMsg = {
    role: "user",
    content:
`Source inspiration (recent X posts):
${source}

User extra context:
${params.extraContext || "(none)"}

Task:
Generate ONE banger post. Make it unique, not templated, and not repetitive.`
  };

  async function callOnce(): Promise<string> {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [system, user],
        temperature: 0.95,
        presence_penalty: 0.9,
        frequency_penalty: 0.6,
        max_tokens: 180
      })
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI error (${res.status}): ${body.slice(0, 280)}`);
    }

    const data = await res.json() as any;
    const text = data?.choices?.[0]?.message?.content ?? "";
    return String(text).trim();
  }

  for (let i = 0; i < 3; i++) {
    const outRaw = await callOnce();
    const out = clampTweet(outRaw, 280);

    const start = out.split("\n")[0]?.trim() ?? "";
    const startsWithBanned = violatesOpeningBan(start);
    const repeats = params.avoidOpenings.some((o) => start.toLowerCase().startsWith(o.toLowerCase()));
    if (!startsWithBanned && !repeats && out.length > 0) return out;
  }

  return clampTweet(await callOnce(), 280);
}
