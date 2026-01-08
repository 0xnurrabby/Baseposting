import { redis } from "./redis";

/**
 * Lightweight per-user, per-route rate limit.
 * Not bulletproof, but enough to discourage spam.
 */
export async function rateLimit(params: {
  key: string;
  windowSeconds: number;
  max: number;
}): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const now = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(now / params.windowSeconds);
  const redisKey = `bp:rl:${params.key}:${bucket}`;

  const count = await redis.incr(redisKey);
  if (count === 1) {
    await redis.expire(redisKey, params.windowSeconds);
  }
  if (count > params.max) {
    const ttl = await redis.ttl(redisKey);
    return { ok: false, retryAfterSeconds: Math.max(1, Number(ttl) || params.windowSeconds) };
  }
  return { ok: true };
}
