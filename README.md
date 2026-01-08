# BasePosting — Base + Farcaster Mini App

**Domain (hardcoded for production):** https://baseposting.online/

## What it does
- Fetches the latest X/Twitter posts via **Apify** (configurable; default 50).
- Uses **GPT API** to generate a **unique, human-like “Base banger”** per click.
- Credits system:
  - New user starts with **10 credits**.
  - **Generate = -1 credit**
  - **Share (once per UTC day) = +2 credits**
  - **Onchain tx on Base to the credit contract = +1 credit** (receipt verified server-side; no double counting)

## Local dev
> Note: Mini App chrome (no address bar) only appears when launched inside a Mini App surface.
> Local dev is for UI/API iteration.

```bash
npm i
npm run dev
```

## Deploy to Vercel (production)
1. Create a Vercel project from this repo.
2. Set the project’s production domain to **baseposting.online**.
3. Add environment variables:

### Required env vars
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `OPENAI_API_KEY`

### Optional / recommended env vars
- `OPENAI_MODEL` (default: `gpt-4o-mini`)
- `APIFY_TOKEN`
- `APIFY_LIMIT` (default 50)

**Apify source configuration (choose one):**
- `APIFY_DATASET_ID` (recommended: fastest/cheapest — app reads latest items from dataset)
- OR `APIFY_ACTOR_ID` + `APIFY_ACTOR_INPUT_JSON` (app runs the actor and reads the default dataset)

**Onchain verification:**
- `BASE_RPC_URL` (a Base mainnet JSON-RPC endpoint; used only for tx receipt verification)

## Farcaster Mini App requirements
This project includes:
- `public/.well-known/farcaster.json`
- `index.html` contains both meta tags:
  - `<meta name="fc:miniapp" ...>`
  - `<meta name="fc:frame" ...>`

## Files to know
- `index.html` — embed meta tags (strict JSON)
- `public/.well-known/farcaster.json` — Farcaster manifest
- `api/` — Vercel serverless functions (credits, generate, share, verify-tx)
- `src/` — UI + Farcaster SDK integration

