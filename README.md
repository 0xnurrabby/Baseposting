# BasePosting (Base + Farcaster Mini App)

**Domain:** https://baseposting.online/

Mini App that:
- Scrapes latest X/Twitter posts from an Apify Dataset
- Uses OpenAI GPT to generate **Base-focused banger posts** (1 click = 1 post)
- Uses a credit system (10 free credits on first use)
- Lets users earn credits via:
  - 1 Base tx to `0xB331328F506f2D35125e367A190e914B1b6830cF` = +1 credit (server verifies receipt on chainId 8453)
  - 1 share per UTC day = +2 credits

## Environment variables (Vercel)

Required:
- `OPENAI_API_KEY`
- `APIFY_TOKEN`
- `APIFY_DATASET_ID`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Notifications (Base + Farcaster):
- `NEYNAR_API_KEY` (required to verify notification webhooks)
- `CRON_SECRET` (protects cron + admin endpoints)
- `NOTIF_APP_URL` (optional, defaults to https://baseposting.online)
- `NOTIF_CADENCE_HOURS` (optional, default 2)

Recommended:
- `OPENAI_MODEL` (default `gpt-4o-mini`)
- `BASE_RPC_URL` (default `https://mainnet.base.org`)

### Farcaster verification (required for production discovery)
Set these to your signed values (publish guide):
- `FARCASTER_ACCOUNT_ASSOCIATION_HEADER`
- `FARCASTER_ACCOUNT_ASSOCIATION_PAYLOAD`
- `FARCASTER_ACCOUNT_ASSOCIATION_SIGNATURE`

## Local dev

```bash
npm install
npm run dev
```

## Deploy

Deploy to Vercel as a Vite app with Serverless Functions.

- Output directory: `dist`
- Build command: `npm run build`

`/.well-known/farcaster.json` is served via a Vercel rewrite to `/api/farcaster` (and also exists as a static fallback in `public/.well-known/farcaster.json`).

## Notifications setup (every 2 hours)

1) Make sure `public/.well-known/farcaster.json` (and `/api/farcaster`) includes:
   - `miniapp.webhookUrl` (and/or `frame.webhookUrl`) pointing to `https://<your-domain>/api/webhook`

2) Set env vars in Vercel:
   - `NEYNAR_API_KEY` (used by `parseWebhookEvent` verification)
   - `CRON_SECRET` (a long random string)

3) Create a QStash schedule to call:
   - `https://<your-domain>/api/cron/notifications`
   - method: POST
   - header: `Upstash-Forward-Authorization: Bearer <CRON_SECRET>`
   - cadence: every 10 minutes (the server enforces the 2 hour cadence per user)

4) Debug endpoints (also protected by `CRON_SECRET` via `Authorization: Bearer <CRON_SECRET>`):
   - `GET /api/admin/notifs/status`
   - `GET /api/admin/notifs/events`
   - `POST /api/admin/notifs/send-test`
   - `POST /api/admin/notifs/reschedule` with `{ "hours": 2 }`

## Leaderboard setup (every 10 minutes)

Leaderboard shows **Top 50** users by **credits spent** (post + photo generation) with two ranges:
- **Last 7 days**
- **Previous week**

### How it works
- Each successful generation logs per-day counters in Upstash Redis.
- A cron endpoint aggregates these per-day hashes and stores a precomputed Top 50 list.

### QStash schedule
Create a QStash schedule to call:
- `https://<your-domain>/api/cron/leaderboard`
- method: POST
- header: `Upstash-Forward-Authorization: Bearer <CRON_SECRET>`
- cadence: every 10 minutes

### Debug keys in Upstash Data Browser
The cron also stores readable strings:
- `admin:leaderboard_7d`
- `admin:leaderboard_prev`

## Builder attribution (ERC-8021)

`public/builder-attribution.js` imports Attribution exactly from:

```js
import { Attribution } from "https://esm.sh/ox/erc8021";
```

It exposes `window.__ERC8021_DATA_SUFFIX__` which is passed into the wallet request via:

```js
request.capabilities = { dataSuffix }
```

Replace `TODO_REPLACE_BUILDER_CODE` with your real Builder Code.
