# BasePosting (Base + Farcaster Mini App)

Production-ready Mini App deployed at **https://baseposting.online/**.

## What it does

- Scrapes the latest X/Twitter posts via **Apify**
- Uses **OpenAI** to generate a **unique, human-like, Base-focused** “banger” post (each click = different output)
- Credits:
  - New user: **10 free credits**
  - **Generate** costs **1** credit
  - **Get Credit**: onchain tx to `https://baseposting.online/` credit contract awards **+1** after backend receipt verification
  - **Share for 2 credit**: once per UTC day, awards **+2** after successful compose action
- Includes a **Tip** bottom-sheet modal that sends **USDC on Base** using **EIP-5792 wallet_sendCalls**.

## Requirements

### 1) Environment variables

Create a `.env.local` (for local dev) and set these in Vercel for production:

```bash
# REQUIRED
APIFY_TOKEN=...
OPENAI_API_KEY=...

# Optional but recommended
OPENAI_MODEL=gpt-4o-mini
APIFY_ACTOR_ID=web.harvester/twitter-scraper
APIFY_MAX_POSTS=50

# Vercel KV (recommended for production storage)
KV_REST_API_URL=...
KV_REST_API_TOKEN=...

# Optional Base RPC for tx receipt verification
BASE_RPC_URL=https://mainnet.base.org
```

> Storage: This app uses **@vercel/kv**. On Vercel, create a **KV** database and attach it to this project.

### 2) Install & run

```bash
npm i
npm run dev
```

### 3) Deploy to Vercel

- Push the repo to GitHub
- Import into Vercel
- Add env vars
- Ensure your custom domain is **baseposting.online**

## Mini App critical files

- **Manifest**: `public/.well-known/farcaster.json`
- **Share embed image**: `public/assets/embed-3x2.png`
- **Meta tags**: `app/layout.tsx` includes both:
  - `<meta name="fc:miniapp" ... />`
  - `<meta name="fc:frame" ... />`

## IMPORTANT: Account Association (Base Build)

Base docs describe signing your manifest to generate the `accountAssociation` fields (header/payload/signature). In this repo they are present but empty; use Base Build to generate and paste them into `public/.well-known/farcaster.json` before publishing.

## Security notes

- Credits are tracked server-side in KV.
- Tx crediting is **receipt-verified** and **txHash is de-duplicated**.
- Output generation is constrained to:
  - source posts (Apify)
  - a small static list of Base facts
  - user-provided context

## Customize

- Tweet scrape strategy: `lib/apify.ts` → `guessActorInput()`
- AI generation: `app/api/generate/route.ts` (seeded “variety engine”)

