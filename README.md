# Base Post Generator — Farcaster Mini App (Base)

Production-ready terminal-themed Mini App that:
- SYNCs your latest Apify-collected X posts into Postgres
- Shows a FEED of the latest 50 (newest first)
- Generates fresh, original variants via OpenAI (with overlap-guard + retries)
- Credits system (10 free on first login, -1 per generation)
- Earn credits via onchain contract execution (+1 each)
- Daily “Share for 2 credit”
- Tip button (USDC on Base) with ERC-5792 `wallet_sendCalls`
- Notifications via webhook + Vercel Cron (every 2 hours)

## Deploy (Vercel)

1. Push this repo to GitHub.
2. Create a new Vercel project from the repo.
3. Add Environment Variables (below).
4. Deploy.
5. Verify these URLs exist on your deployed domain:
   - https://baseposting.online/.well-known/farcaster.json
   - https://baseposting.online/  (home)

## Required Environment Variables

### Backend
- `APIFY_TOKEN`
- `APIFY_DATASET_ID`
- `OPENAI_API_KEY`
- `DATABASE_URL` (Postgres; Vercel Postgres works)

### Strongly recommended (notifications + security)
- `NEYNAR_API_KEY`  
  Needed by `@farcaster/miniapp-node` webhook verification (`verifyAppKeyWithNeynar`).

### Optional
- `OPENAI_MODEL` (default: `gpt-4o-mini`)
- `BASE_RPC_URL` (default: `https://mainnet.base.org`)
- `CRON_SECRET` (if set, cron endpoint requires `?key=<CRON_SECRET>` or `x-cron-secret` header)

### Frontend (public)
- `NEXT_PUBLIC_BUILDER_CODE` (REQUIRED to enable Tip + Get Credit sends)
- `NEXT_PUBLIC_TIP_RECIPIENT` (REQUIRED to enable Tips)

## How to use

### 1) Sync
Open the Mini App and press **SYNC FROM APIFY**.
You’ll see terminal-style logs (fetching → upserting → done).

### 2) Feed
Feed auto-loads after sync and always prioritizes the latest 50 by timestamp.
Use:
- Base-only toggle
- Include replies/RT toggle
- Search

### 3) Generate
Press **GENERATE** on any item:
- Style preset
- Length
- Variant count (3/5/10)
- Credit on INFO posts (default ON)

Each generate consumes **1 credit**.

### 4) Credits
- New users start with **10 free** credits.
- **Get Credit (+1 via contract)**: triggers an onchain call to `0xB331328F506f2D35125e367A190e914B1b6830cF`, then server verifies the tx and adds 1 credit.
- **Share for 2 credit (daily)**: opens the compose flow and then adds 2 credits once per UTC day.

### 5) Post + Copy
Every generated variant shows:
- **Copy**
- **Post** (opens in-app composer via `sdk.actions.composeCast()`)

## Notifications
This app stores notification tokens via the webhook:

- `POST /api/webhook`

Then Vercel Cron hits:

- `/api/cron/notify` every 2 hours (see `vercel.json`)

If you set `CRON_SECRET`, update the cron schedule in Vercel to call:
- `/api/cron/notify?key=<CRON_SECRET>`

## Notes
- Overlap guard: rejects outputs that reuse > 6 consecutive words from the input, and auto-regenerates (max 2 retries).
- “Do not invent facts”: if the input is vague/hype, output becomes a discussion prompt or neutral commentary.
- Credit line: only appended for INFO-like inputs (URL / update keywords / numbers) when Credit toggle is ON.
