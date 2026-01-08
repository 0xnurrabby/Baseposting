import { Redis } from "@upstash/redis";

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = (redisUrl && redisToken) ? new Redis({ url: redisUrl, token: redisToken }) : null;

const mem = globalThis as unknown as {
  __bp_credits?: Map<string, number>;
  __bp_daily?: Map<string, string>;
  __bp_recentOpeners?: Map<string, string[]>;
};
if (!mem.__bp_credits) mem.__bp_credits = new Map();
if (!mem.__bp_daily) mem.__bp_daily = new Map();
if (!mem.__bp_recentOpeners) mem.__bp_recentOpeners = new Map();

function tzDateKey(tz = "Asia/Dhaka"): string {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(new Date());
}

function creditsKey(userId: string) { return `bp:credits:${userId}`; }
function dailyShareKey(userId: string) { return `bp:dailyShare:${userId}`; }
function recentOpenersKey(userId: string) { return `bp:recentOpeners:${userId}`; }

export async function getCredits(userId: string): Promise<number> {
  if (redis) {
    const v = await redis.get<number>(creditsKey(userId));
    return typeof v === "number" ? v : 0;
  }
  return mem.__bp_credits!.get(userId) ?? 0;
}

export async function setCredits(userId: string, credits: number): Promise<void> {
  const c = Math.max(0, Math.floor(credits));
  if (redis) {
    await redis.set(creditsKey(userId), c);
    return;
  }
  mem.__bp_credits!.set(userId, c);
}

export async function addCredits(userId: string, delta: number): Promise<number> {
  const current = await getCredits(userId);
  const next = Math.max(0, current + Math.floor(delta));
  await setCredits(userId, next);
  return next;
}

export async function spendCredits(userId: string, amount: number): Promise<number> {
  const current = await getCredits(userId);
  if (current < amount) throw new Error("Not enough credits");
  const next = current - amount;
  await setCredits(userId, next);
  return next;
}

export async function dailyShareStatus(userId: string, tz = "Asia/Dhaka"): Promise<{ used: boolean; dayKey: string }> {
  const dayKey = tzDateKey(tz);
  if (redis) {
    const v = await redis.get<string>(dailyShareKey(userId));
    return { used: v === dayKey, dayKey };
  }
  const v = mem.__bp_daily!.get(userId);
  return { used: v === dayKey, dayKey };
}

export async function markDailyShareUsed(userId: string, tz = "Asia/Dhaka"): Promise<void> {
  const dayKey = tzDateKey(tz);
  if (redis) {
    await redis.set(dailyShareKey(userId), dayKey);
    return;
  }
  mem.__bp_daily!.set(userId, dayKey);
}

export async function getRecentOpeners(userId: string): Promise<string[]> {
  if (redis) {
    const v = await redis.get<string[]>(recentOpenersKey(userId));
    return Array.isArray(v) ? v : [];
  }
  return mem.__bp_recentOpeners!.get(userId) ?? [];
}

export async function pushRecentOpener(userId: string, opener: string): Promise<void> {
  const max = 12;
  const list = (await getRecentOpeners(userId)).filter(Boolean);
  const next = [opener, ...list.filter((x) => x !== opener)].slice(0, max);
  if (redis) {
    await redis.set(recentOpenersKey(userId), next);
    return;
  }
  mem.__bp_recentOpeners!.set(userId, next);
}
