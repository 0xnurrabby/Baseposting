const INFO_KEYWORDS = [
  "released","launched","announced","mainnet","update","version","integration",
  "proposal","docs","guide","audit","status","incident"
];

function hasNumberOrDate(text) {
  return /\b\d{1,4}([\/-]\d{1,2}){1,2}\b/.test(text) || /\b\d+\b/.test(text);
}

function isInfoLike({ text, url }) {
  const t = (text || "").toLowerCase();
  if (url && url.trim()) return true;
  if (INFO_KEYWORDS.some(k => t.includes(k))) return true;
  if (hasNumberOrDate(t)) return true;
  return false;
}

function categoryOf({ text, url }) {
  if (isInfoLike({ text, url })) return "INFO";
  const t = (text || "").toLowerCase();
  // lightweight meme heuristics
  const memeish = /\b(lol|lmao|gm|ngmi|wagmi|rekt|based|cope|bro)\b/.test(t) || /😂|🤣|💀|🔥|🫡|🥶/.test(t);
  return memeish ? "MEME" : "OPINION";
}

function confidenceOf({ text, url }) {
  const t = (text || "").toLowerCase();
  const concrete = !!(url && url.trim()) ||
    /\b(released|launched|announced|version|status|docs|guide|audit|incident)\b/.test(t) ||
    /\b\d+\b/.test(t);
  return concrete ? "HIGH" : "LOW";
}

module.exports = { categoryOf, confidenceOf, isInfoLike };
