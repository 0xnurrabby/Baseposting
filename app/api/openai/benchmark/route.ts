import { NextResponse } from "next/server";
import OpenAI from "openai";

type TestResult = {
  name: string;
  ok: boolean;
  latencyMs: number;
  outputText?: string;
  error?: string;
  qualityPass?: boolean;
  tokens?: { input?: number; output?: number };
};

function percentile(values: number[], p: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

export async function POST(req: Request) {
  try {
    const { apiKey, model, runsPerTest = 1, temperature } = (await req.json()) as {
      apiKey: string;
      model: string;
      runsPerTest?: number;
      temperature?: number;
    };

    if (!apiKey || typeof apiKey !== "string") {
      return NextResponse.json({ error: "Missing apiKey" }, { status: 400 });
    }
    if (!model || typeof model !== "string") {
      return NextResponse.json({ error: "Missing model" }, { status: 400 });
    }

    const client = new OpenAI({ apiKey });

    const tests: { name: string; prompt: string; evaluate: (t: string) => boolean }[] = [
      {
        name: "JSON arithmetic",
        prompt: 'Return ONLY valid JSON exactly like this schema: {"result": number}. Now compute 17*3. No extra text.',
        evaluate: (t) => {
          try {
            const j = JSON.parse(t.trim());
            return typeof j?.result === "number" && j.result === 51;
          } catch {
            return false;
          }
        },
      },
      {
        name: "Strict one-word",
        prompt: "Reply with exactly one word: CAPY.",
        evaluate: (t) => t.trim() === "CAPY",
      },
      {
        name: "JSON schema keys",
        prompt:
          'Return ONLY valid JSON with keys: name (string), ok (boolean), items (array of 3 numbers). Use name="test", ok=true, items=[1,2,3].',
        evaluate: (t) => {
          try {
            const j = JSON.parse(t.trim());
            return j?.name === "test" && j?.ok === true && Array.isArray(j?.items) && j.items.join(",") === "1,2,3";
          } catch {
            return false;
          }
        },
      },
      {
        name: "Short reasoning",
        prompt: "In one short sentence, explain what an API key is.",
        evaluate: (t) => t.trim().length > 10,
      },
      {
        name: "Coding (text)",
        prompt:
          "Write a JavaScript function named isEven(n) that returns true if n is even, false otherwise. Reply with ONLY the function code, no markdown.",
        evaluate: (t) => t.includes("function isEven") && t.includes("return") && !t.includes("```"),
      },
    ];

    const results: TestResult[] = [];

    for (const test of tests) {
      for (let i = 0; i < Math.max(1, runsPerTest); i++) {
        const t0 = Date.now();
        try {
          const resp = await client.responses.create({
            model,
            input: [
              {
                role: "user",
                content: [{ type: "input_text", text: test.prompt }],
              },
            ],
            temperature: typeof temperature === "number" ? temperature : 0,
          });

          const latencyMs = Date.now() - t0;
          const outputText = (resp.output_text ?? "").trim();
          const qualityPass = test.evaluate(outputText);
          const usage = (resp as any).usage;

          results.push({
            name: `${test.name}${runsPerTest > 1 ? ` #${i + 1}` : ""}`,
            ok: true,
            latencyMs,
            outputText,
            qualityPass,
            tokens: usage
              ? { input: usage.input_tokens, output: usage.output_tokens }
              : undefined,
          });
        } catch (e: any) {
          const latencyMs = Date.now() - t0;
          results.push({
            name: `${test.name}${runsPerTest > 1 ? ` #${i + 1}` : ""}`,
            ok: false,
            latencyMs,
            error: e?.message || "Request failed",
            qualityPass: false,
          });
        }
      }
    }

    const latencies = results.map((r) => r.latencyMs);
    const successCount = results.filter((r) => r.ok).length;
    const qualityPassCount = results.filter((r) => r.qualityPass).length;

    const tokenIn = results.reduce((s, r) => s + (r.tokens?.input || 0), 0);
    const tokenOut = results.reduce((s, r) => s + (r.tokens?.output || 0), 0);

    const summary = {
      total: results.length,
      successRate: results.length ? successCount / results.length : 0,
      qualityPassRate: results.length ? qualityPassCount / results.length : 0,
      latencyP50: percentile(latencies, 50),
      latencyP95: percentile(latencies, 95),
      tokens: { input: tokenIn, output: tokenOut },
      // Score out of 100
      score: Math.round(
        25 * (results.length ? successCount / results.length : 0) +
          25 * (results.length ? qualityPassCount / results.length : 0) +
          25 * (latencies.length ? Math.max(0, 1 - (percentile(latencies, 95) || 0) / 20000) : 0) +
          25 * (tokenIn + tokenOut ? Math.max(0, 1 - (tokenIn + tokenOut) / 10000) : 0)
      ),
    };

    return NextResponse.json({ summary, results });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Benchmark failed" }, { status: 500 });
  }
}
