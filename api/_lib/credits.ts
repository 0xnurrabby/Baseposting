import { redis } from "./redis";

export type UserState = {
  credits: number;
  lastShareUtcDate?: string | null;
  createdAt: number;
  updatedAt: number;
};

const USER_KEY = (userId: string) => `bp:user:${userId}`;
const TX_SEEN_KEY = "bp:tx:seen";

export function utcDateString(d = new Date()) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export async function ensureUser(userId: string): Promise<UserState> {
  const key = USER_KEY(userId);
  const existing = await redis.hgetall<UserState>(key);

  if (!existing || Object.keys(existing).length === 0) {
    const now = Date.now();
    const state: UserState = { credits: 10, lastShareUtcDate: null, createdAt: now, updatedAt: now };
    await redis.hset(key, state as any);
    return state;
  }

  return {
    credits: Number((existing as any).credits ?? 0),
    lastShareUtcDate: (existing as any).lastShareUtcDate ?? null,
    createdAt: Number((existing as any).createdAt ?? Date.now()),
    updatedAt: Number((existing as any).updatedAt ?? Date.now()),
  };
}

export async function getCredits(userId: string) {
  const state = await ensureUser(userId);
  return state.credits;
}

export async function setCredits(userId: string, credits: number) {
  const key = USER_KEY(userId);
  await redis.hset(key, { credits, updatedAt: Date.now() } as any);
}

export async function consumeCredit(userId: string, amount = 1): Promise<{ ok: true; credits: number } | { ok: false; credits: number }> {
  const key = USER_KEY(userId);
  await ensureUser(userId);
  // Atomic decrement
  const credits = await redis.hincrby(key, "credits", -amount);
  const updated = Number(credits);
  if (updated < 0) {
    // revert
    await redis.hincrby(key, "credits", amount);
    const cur = Number(await redis.hget(key, "credits"));
    return { ok: false, credits: cur };
  }
  await redis.hset(key, { updatedAt: Date.now() } as any);
  return { ok: true, credits: updated };
}

export async function awardCredits(userId: string, amount: number) {
  const key = USER_KEY(userId);
  await ensureUser(userId);
  const credits = await redis.hincrby(key, "credits", amount);
  await redis.hset(key, { updatedAt: Date.now() } as any);
  return Number(credits);
}

export async function awardShareBonus(userId: string): Promise<{ ok: true; credits: number; lastShareUtcDate: string } | { ok: false; error: string; credits: number; lastShareUtcDate?: string | null }> {
  const key = USER_KEY(userId);
  const state = await ensureUser(userId);
  const today = utcDateString();
  if (state.lastShareUtcDate === today) {
    return { ok: false, error: "Already claimed today's share bonus", credits: state.credits, lastShareUtcDate: today };
  }
  const credits = await awardCredits(userId, 2);
  await redis.hset(key, { lastShareUtcDate: today } as any);
  return { ok: true, credits, lastShareUtcDate: today };
}

export async function markTxSeen(txHash: string) {
  return await redis.sadd(TX_SEEN_KEY, txHash.toLowerCase());
}

export async function isTxSeen(txHash: string) {
  const isMember = await redis.sismember(TX_SEEN_KEY, txHash.toLowerCase());
  return Boolean(isMember);
}
