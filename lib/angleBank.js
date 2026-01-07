const ANGLES = [
  "why it matters",
  "how to use (quick steps)",
  "builder takeaway",
  "common mistake to avoid",
  "quick checklist",
  "contrarian angle (careful, no fake facts)",
  "community question",
  "1-sentence summary + 1 action",
  "risk/edge cases",
  "mental model / analogy"
];

function pickAngles(n, seedStr) {
  const seed = hash(seedStr || "");
  const arr = [...ANGLES];
  // deterministic shuffle-ish
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (seed + i * 31) % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.max(1, Math.min(n, arr.length)));
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

module.exports = { pickAngles };
