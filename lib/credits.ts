import { kv } from "@/lib/storage";
import { utcDateString } from "@/lib/text";

export type UserId = string;

const DEFAULT_CREDITS = 10;

function keyCredits(userId: UserId) {
  return `u:${userId}:credits`;
}
function keyHistory(userId: UserId) {
  return `u:${userId}:history`;
}
function keyLastShare(userId: UserId) {
  return `u:${userId}:lastShareDate`;
}
function keyCountedTx(txHash: string) {
  return `tx:${txHash.toLowerCase()}:counted`;
}

export async function getOrInitCredits(userId: UserId) {
  const k = keyCredits(userId);
  const existing = await kv.get<number>(k);
  if (typeof existing === "number") return existing;
  await kv.set(k, DEFAULT_CREDITS);
  return DEFAULT_CREDITS;
}

export async function spendCredit(userId: UserId) {
  const current = await getOrInitCredits(userId);
  if (current <= 0) return { ok: false as const, credits: current };
  await kv.set(keyCredits(userId), current - 1);
  return { ok: true as const, credits: current - 1 };
}

export async function refundCredit(userId: UserId) {
  const current = await getOrInitCredits(userId);
  await kv.set(keyCredits(userId), current + 1);
  return current + 1;
}

export async function addCredits(userId: UserId, n: number) {
  const current = await getOrInitCredits(userId);
  await kv.set(keyCredits(userId), current + n);
  return current + n;
}

export async function canDailyShare(userId: UserId) {
  const today = utcDateString();
  const last = await kv.get<string>(keyLastShare(userId));
  return { ok: last !== today, today, last: typeof last === "string" ? last : null };
}

export async function markDailyShareAndAward(userId: UserId) {
  const chk = await canDailyShare(userId);
  if (!chk.ok) return { ok: false as const, credits: await getOrInitCredits(userId), today: chk.today };
  await kv.set(keyLastShare(userId), chk.today);
  const credits = await addCredits(userId, 2);
  return { ok: true as const, credits, today: chk.today };
}

export async function wasTxCounted(txHash: string) {
  const v = await kv.get<string>(keyCountedTx(txHash));
  return v === "1";
}
export async function markTxCounted(txHash: string) {
  await kv.set(keyCountedTx(txHash), "1");
}

export async function getHistory(userId: UserId) {
  const arr = await kv.lrange<string>(keyHistory(userId), 0, 30);
  return Array.isArray(arr) ? arr : [];
}
export async function pushHistory(userId: UserId, text: string) {
  const k = keyHistory(userId);
  await kv.lpush(k, text);
  await kv.ltrim(k, 0, 20);
}
