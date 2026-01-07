const crypto = require("crypto");
const { q, withTx, qClient } = require("../../lib/db");
const { requireFid } = require("../../lib/auth");
const { client } = require("../../lib/openaiClient");
const { categoryOf, confidenceOf, isInfoLike } = require("../../lib/classify");
const { maxConsecutiveOverlap, trigramJaccard } = require("../../lib/overlap");
const { pickAngles } = require("../../lib/angleBank");

const STYLE_PRESETS = {
  degen: "High energy, short punchy lines, onchain slang. No fake facts.",
  builder: "Practical builder tone. Clear, actionable, slightly opinionated. No fake facts.",
  educational: "Explain like a smart friend. Define terms briefly. No fake facts.",
  story: "Mini-story arc: hook → moment → takeaway. No fake facts.",
  "thread-ish": "Feels like a thread intro (but single post). Tease points. No fake facts.",
  checklist: "Checklist format with bullets/steps. No fake facts.",
  "question-hook": "Start with a question. Invite replies. No fake facts.",
};

const LENGTH_PRESETS = {
  short: "Under ~280 chars if possible. One idea. No filler.",
  medium: "Medium length. 2-4 short paragraphs. Tight.",
  long: "Longer but readable. 3-6 short paragraphs. Still concise.",
};

function sha256(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function parseJsonArray(text) {
  let creditDeducted = false;
  try {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end === -1) return null;
    const raw = text.slice(start, end + 1);
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    return arr.map((x) => String(x).trim()).filter(Boolean);
  } catch {
    return null;
  }
}

function clampVariantCount(n) {
  const x = Number(n) || 3;
  if (x <= 3) return 3;
  if (x <= 5) return 5;
  return 10;
}

async function openaiGenerate({ inputText, url, handle, style, length, n, angles, category }) {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const preset = STYLE_PRESETS[style] || STYLE_PRESETS.builder;
  const len = LENGTH_PRESETS[length] || LENGTH_PRESETS.medium;

  const system = [
    "You are Base Post Generator.",
    "Goal: write a fresh, original Farcaster/X-style post inspired by an input post.",
    "Hard rules:",
    "- Never copy the source. Do NOT reuse any 6-word consecutive sequence from the source.",
    "- Do not invent facts. Only use facts clearly present in the input. If vague/hype, write neutral commentary or a discussion prompt.",
    "- New hook, new structure, new angle. Sound like a real human.",
    "- Output MUST be a JSON array of strings, nothing else."
  ].join("\n");

  const user = [
    `SOURCE_HANDLE: ${handle}`,
    `SOURCE_URL: ${url || ""}`,
    `CATEGORY_HINT: ${category}`,
    `STYLE_PRESET: ${style} — ${preset}`,
    `LENGTH: ${length} — ${len}`,
    `ANGLE_OPTIONS: ${angles.join(" | ")}`,
    "",
    "SOURCE_TEXT:",
    inputText,
    "",
    `TASK: Produce ${n} distinct variants. Each variant must choose a different angle from ANGLE_OPTIONS. Keep them meaningfully different from each other.`,
    "Return only JSON."
  ].join("\n");

  const c = client();
  const resp = await c.responses.create({
    model,
    input: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    temperature: 0.9,
    max_output_tokens: 800
  });

  const out = resp.output_text || "";
  const arr = parseJsonArray(out);
  if (!arr || arr.length < 1) {
    throw new Error("Model did not return a valid JSON array.");
  }
  return arr.slice(0, n);
}

function validateVariant(src, variant) {
  const maxOverlap = maxConsecutiveOverlap(src, variant);
  const tri = trigramJaccard(src, variant);
  const ok = maxOverlap <= 6 && tri <= 0.35;
  return { ok, maxOverlap, trigram: tri };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const fid = await requireFid(req);
  if (!fid) return res.status(401).json({ error: "Not authenticated. Open inside Farcaster client." });

  const body = req.body || {};
  const tweetId = String(body.tweetId || "").trim();
  const style = String(body.style || "builder");
  const length = String(body.length || "medium");
  const variantCount = clampVariantCount(body.variantCount);
  const creditOnInfo = body.creditOnInfo !== false;

  if (!tweetId) return res.status(400).json({ error: "Missing tweetId" });

  let creditDeducted = false;
  try {
    const result = await withTx(async (client) => {
  // Ensure user exists
  await qClient(client, `INSERT INTO user_credits (fid, credits) VALUES ($1, 10) ON CONFLICT (fid) DO NOTHING;`, [fid]);

  // Lock credit row
  const cr = await qClient(client, `SELECT credits FROM user_credits WHERE fid=$1 FOR UPDATE;`, [fid]);
  const credits = cr.rows?.[0]?.credits ?? 0;
  if (credits < 1) {
    const err = new Error("No credits left. Earn more with Get Credit or Share.");
    err.statusCode = 402;
    throw err;
  }

  // Deduct 1 credit per generation action
  await qClient(client, `UPDATE user_credits SET credits = credits - 1, updated_at = NOW() WHERE fid=$1;`, [fid]);

  // Load post
  const r = await qClient(client, `SELECT * FROM raw_posts WHERE tweet_id=$1;`, [tweetId]);
  const post = r.rows?.[0];
  if (!post) {
    const err = new Error("Post not found. Sync first.");
    err.statusCode = 404;
    throw err;
  }

  return { post };
});

const post = result.post;

const category = categoryOf({ text: post.text, url: post.url });
const confidence = confidenceOf({ text: post.text, url: post.url });
const infoLike = isInfoLike({ text: post.text, url: post.url });

const angles = pickAngles(variantCount, tweetId + ":" + Date.now());

let variants = [];
let attempts = 0;

// Fetch recent outputs to avoid near duplicates (lightweight)
const prev = await q(
  `SELECT content FROM generated_posts WHERE fid=$1 ORDER BY created_at DESC LIMIT 40;`,
  [fid]
);
const prevTexts = prev.rows.map(r => r.content);

while (attempts < 3) {
  attempts++;
  const gen = await openaiGenerate({
    inputText: post.text,
    url: post.url,
    handle: post.handle,
    style,
    length,
    n: variantCount,
    angles,
    category
  });

  // Validate & enforce uniqueness
  variants = gen.map(v => v.trim()).filter(Boolean);

  const validations = variants.map(v => validateVariant(post.text, v));
  const badIdx = validations
    .map((v, idx) => ({ ...v, idx }))
    .filter(v => !v.ok)
    .map(v => v.idx);

  // Similarity-to-history check (optional)
  const tooSimilar = new Set();
  for (let i = 0; i < variants.length; i++) {
    for (const p of prevTexts) {
      if (trigramJaccard(p, variants[i]) > 0.82) {
        tooSimilar.add(i);
        break;
      }
    }
  }

  const anyBad = badIdx.length > 0 || tooSimilar.size > 0;
  if (!anyBad) break;

  if (attempts >= 3) break;

  // Regenerate only the bad ones
  const need = new Set([...badIdx, ...tooSimilar]);
  const needCount = need.size;

  const regenAngles = pickAngles(Math.min(needCount, 8), tweetId + ":regen:" + attempts + ":" + Date.now());

  const regen = await openaiGenerate({
    inputText: post.text,
    url: post.url,
    handle: post.handle,
    style,
    length,
    n: needCount,
    angles: regenAngles,
    category
  });

  let rIdx = 0;
  for (const idx of need) {
    if (regen[rIdx]) variants[idx] = regen[rIdx];
    rIdx++;
  }
}

// Final pass: append credit line if INFO and toggle ON
const final = variants.map((v) => {
  const content = String(v).trim();
  if (infoLike && creditOnInfo) {
    return content + "\n\nsource: " + post.handle;
  }
  return content;
});

// Store variants in a single transaction
await withTx(async (client) => {
  for (let i = 0; i < final.length; i++) {
    const content = final[i];
    await qClient(
      client,
      `
      INSERT INTO generated_posts
        (fid, tweet_id, variant_index, style, length, category, confidence, credit_on, content, content_hash)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `,
      [fid, post.tweet_id, i, style, length, category, confidence, Boolean(creditOnInfo), content, sha256(content)]
    );
  }
});

const creditsAfter = await q(`SELECT credits FROM user_credits WHERE fid=$1;`, [fid]);

return res.status(200).json({
  ok: true,
  tweetId,
  style,
  length,
  category,
  confidence,
  creditOnInfo,
  variants: final,
  credits: creditsAfter.rows?.[0]?.credits ?? null
});
      } catch (e) {
    try {
      if (creditDeducted && (e?.statusCode !== 402)) {
        await q(`UPDATE user_credits SET credits = credits + 1, updated_at = NOW() WHERE fid=$1;`, [fid]);
      }
    } catch {}
return res.status(e?.statusCode || 500).json({ error: e?.message || String(e) });
  }
}
