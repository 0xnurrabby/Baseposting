import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  // Functions still load, but will error on first use with a clear message.
  console.warn("Missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN");
}

export const redis = new Redis({
  url: url ?? "https://example.invalid",
  token: token ?? "example",
});
