function normalizeWords(s) {
  return (s || "")
    .toLowerCase()
    .replace(/https?:\/\/[\S]+/g, " ")
    .replace(/[^a-z0-9\s@#]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Returns maximum number of consecutive words shared between input and output.
 * Constraint: output must not reuse >6 consecutive words from input.
 */
function maxConsecutiveOverlap(inputText, outputText) {
  const a = normalizeWords(inputText);
  const b = normalizeWords(outputText);
  if (!a.length || !b.length) return 0;

  const index = new Map();
  for (let i = 0; i < a.length; i++) {
    const w = a[i];
    if (!index.has(w)) index.set(w, []);
    index.get(w).push(i);
  }

  let best = 0;
  // DP with sparse matching: for each b[j], check all positions i where a[i] == b[j]
  // and extend streak using prev map
  let prev = new Map(); // key: i in a, value: streak ending at i with current b position
  for (let j = 0; j < b.length; j++) {
    const positions = index.get(b[j]) || [];
    const cur = new Map();
    for (const i of positions) {
      const streak = (prev.get(i - 1) || 0) + 1;
      cur.set(i, streak);
      if (streak > best) best = streak;
    }
    prev = cur;
    if (best > 12) break; // early exit
  }
  return best;
}

function trigramJaccard(aText, bText) {
  const a = normalizeWords(aText);
  const b = normalizeWords(bText);
  function trigrams(ws) {
    const s = new Set();
    for (let i = 0; i < ws.length - 2; i++) {
      s.add(ws[i] + " " + ws[i+1] + " " + ws[i+2]);
    }
    return s;
  }
  const A = trigrams(a);
  const B = trigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

module.exports = { maxConsecutiveOverlap, trigramJaccard };
