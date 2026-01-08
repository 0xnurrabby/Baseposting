export function clamp(str: string, max: number) {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
}

export function stripControlChars(s: string) {
  return s.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

export function utcDateString(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
