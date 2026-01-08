import { z } from "zod";

export const env = z
  .object({
    // Public
    NEXT_PUBLIC_DOMAIN: z.string().default("https://baseposting.online"),
    // Apify
    APIFY_TOKEN: z.string().min(1, "APIFY_TOKEN is required"),
    APIFY_ACTOR_ID: z.string().default("web.harvester/twitter-scraper"),
    APIFY_MAX_POSTS: z.string().default("50"),

    // OpenAI
    OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
    OPENAI_MODEL: z.string().default("gpt-4o-mini"),

    // Storage (Vercel KV / Upstash)
    KV_REST_API_URL: z.string().optional(),
    KV_REST_API_TOKEN: z.string().optional(),

    // RPC for tx verification (optional; falls back to public)
    BASE_RPC_URL: z.string().optional(),
  })
  .parse(process.env);
