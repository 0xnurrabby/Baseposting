import { env } from "@/lib/env";

type OpenAIResponse = {
  output_text?: string;
  output?: any;
};

export async function generatePost(params: {
  system: string;
  user: string;
  temperature?: number;
}): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      input: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
      temperature: params.temperature ?? 0.9,
      max_output_tokens: 220,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenAI error: ${res.status} ${t}`);
  }

  const json: OpenAIResponse = await res.json();
  // responses API typically has output_text
  const text = (json as any).output_text;
  if (typeof text === "string" && text.trim()) return text.trim();

  // fallback: try to pull from output array
  const out = (json as any).output;
  if (Array.isArray(out)) {
    const pieces: string[] = [];
    for (const item of out) {
      if (item?.type === "message") {
        for (const c of item?.content ?? []) {
          if (c?.type === "output_text" && typeof c?.text === "string") pieces.push(c.text);
        }
      }
    }
    if (pieces.join("").trim()) return pieces.join("").trim();
  }

  throw new Error("OpenAI returned empty output");
}
