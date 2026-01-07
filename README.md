# Base Post Generator (Base + Farcaster Mini App)

Domain (hard-coded): https://baseposting.online/

This is a **Farcaster Mini App** that:
- Syncs the newest X posts from **Apify Dataset API** (upserts by `tweet_id`)
- Shows a **latest-50** terminal feed
- Generates **fresh, original** cast variants with GPT
- Enforces an **overlap guard** (no 7-word overlap) and auto-regenerates
- Uses **credits**:
  - New users get **10 free credits**
  - **Get Credit**: executes an onchain contract tx (+1 credit)
  - **Share for 2 credit**: once per day (+2)
  - **Generate**: costs **1 credit per generation action**
- Sends **notifications every 2 hours** (Vercel Cron) to users who enabled notifications
- Includes an in-app **Tip (USDC)** bottom-sheet using **ERC-5792 wallet_sendCalls**.

---

## 1) Required Environment Variables (Vercel + Local)

Set these on Vercel (Project → Settings → Environment Variables) and in `.env.local` locally:

- `APIFY_TOKEN`
- `APIFY_DATASET_ID`
- `OPENAI_API_KEY`
- `DATABASE_URL`

**Recommended (for notifications verification):**
- `NEYNAR_API_KEY`  
  Required to reliably verify notification webhooks (Base Mini Apps docs strongly recommend this).

**Optional:**
- `OPENAI_MODEL` (default: `gpt-4o-mini`)
- `BASE_RPC_URL` (default: `https://mainnet.base.org`)
- `CRON_SECRET` (if set, `/api/cron/notify` requires `Authorization: Bearer <CRON_SECRET>`)

---

## 2) Database Setup

This app uses Prisma + Postgres (Vercel Postgres recommended).

On Vercel, create a Postgres DB and set `DATABASE_URL`.

After deploy, run migrations (Vercel automatically runs `postinstall` → prisma generate).  
For migrations, run:
```bash
npx prisma migrate deploy
```

---

## 3) Farcaster Mini App Publishing (MANDATORY)

**Important:** A Mini App must include a valid `accountAssociation` in:
`/public/.well-known/farcaster.json`.

This repo includes placeholders:
- `REPLACE_WITH_WARPCAST_MANIFEST_TOOL_HEADER`
- `REPLACE_WITH_WARPCAST_MANIFEST_TOOL_PAYLOAD`
- `REPLACE_WITH_WARPCAST_MANIFEST_TOOL_SIGNATURE`

Use Warpcast’s manifest signing tool (Publishing guide) to generate the correct values and paste them into the file.

---

## 4) Run Locally

```bash
npm install
npm run dev
```

---

## 5) Using the App

### Sync from Apify
Click **SYNC FROM APIFY** (COMMANDS panel).  
The app will:
- fetch newest items from Apify dataset API
- upsert into DB using `tweetId`
- show terminal-style logs

### Generate
1. Click a feed item.
2. Choose style/length/variant count.
3. Click **GENERATE** (costs 1 credit).
4. Output panel shows variants with **Copy** + **Post directly**.

### Credits
- New users start with **10 credits**
- **Get Credit (+1)**: does an onchain tx to the credit contract and then verifies txHash server-side
- **Share for 2 credit (daily)**: opens composer and then grants once per UTC day.

### Notifications
Click **Enable notifications**.  
If the client prompts, enable notifications.  
Webhook tokens are stored in DB and **Vercel Cron** sends a reminder every 2 hours.

---

## 6) Tip (USDC)

Tip button opens a custom bottom sheet:
- preset $1 / $5 / $10 / $25
- custom input
- state machine:
  - Send USDC → Preparing tip… → Confirm in wallet → Sending… → Send again

USDC transfer is manually encoded and sent via `wallet_sendCalls`.

> IMPORTANT: You must set:
- `RECIPIENT` in `components/TipSheet.tsx`
- `BUILDER_CODE` in `public/sdk/attribution.js`

If either is still default, tip sending is disabled (no crashes).

---

## 7) Deployment

Deploy to Vercel:
- Import repo
- Set env vars
- Deploy
- Ensure `.well-known/farcaster.json` is correctly signed

Then open in Farcaster / Base Build preview.

