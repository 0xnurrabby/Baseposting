<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=6,11,20&height=180&section=header&text=BasePosting&fontSize=52&fontColor=000000&fontAlignY=38&desc=AI-powered+Base+post+generator+as+a+Farcaster+mini+app&descAlignY=58&descSize=14&animation=fadeIn" width="100%"/>

<div align="center">

[![Live](https://img.shields.io/badge/Live%20App-bbf7d0?style=for-the-badge&logoColor=000)](https://www.baseposting.online)
[![License](https://img.shields.io/badge/MIT-bfdbfe?style=for-the-badge&logoColor=000)](LICENSE)
[![Platform](https://img.shields.io/badge/Farcaster%20Mini%20App-fde68a?style=for-the-badge&logoColor=000)]()
[![Tech](https://img.shields.io/badge/React%20%2B%20TypeScript-fca5a5?style=for-the-badge&logoColor=000)]()

</div>

<div align="center">
<i>Connect your wallet, spend 3 credits, and get a ready-to-post banger for X .... no writer's block, ever.</i>
</div>

---

## ✦ Features

<div align="center">

| | Feature | What it does |
|:---:|---|---|
| 🤖 | AI post generation | Generates high-quality Base ecosystem posts using AI (costs 3 credits) |
| ⛓️ | On-chain credit system | Credits backed by smart contract interactions on Base Mainnet |
| 🐦 | One-click post to X | Share generated posts directly to Twitter/X |
| 🎁 | Daily credit bonus | Share the app for 6 free credits per day |
| 🏆 | Global leaderboard | Track top users by posts generated, sourced from on-chain data |
| 💰 | USDC tip support | Tip the creator in USDC on Base |
| 👛 | Multi-wallet support | Works with MetaMask, Rabby, OKX, Bitget, and more |
| 🌙 | Dark / Light theme | Toggle between dark and light mode |

</div>

---

## ✦ Download & Run

**Step 1** .... Clone the repo

```bash
git clone https://github.com/0xnurrabby/Baseposting
cd Baseposting
```

**Step 2** .... Install and configure

```bash
npm install
# Create a .env file with required vars (see Setup section)
```

**Step 3** .... Start dev server

```bash
npm run dev
# Open http://localhost:5173
```

---

## ✦ Setup

```
1. Clone the repo and run npm install
2. Create a .env file with:
   VITE_TIP_RECIPIENT=0xYourWalletAddress
   UPSTASH_REDIS_REST_URL=your_upstash_url
   UPSTASH_REDIS_REST_TOKEN=your_upstash_token
3. Run npm run dev for local development
4. To deploy: push to GitHub and import in vercel.com
   Vercel auto-detects Vite and runs "npm run build"
   Output goes to /dist folder
```

---

## ✦ Project Structure

```
Baseposting/
  api/
    generate.ts          ->  AI post generation endpoint
    leaderboard.ts       ->  leaderboard data handler
    verify-tx.ts         ->  on-chain transaction verifier
    notif/               ->  Farcaster notification handlers
  src/
    components/          ->  React UI components
    lib/                 ->  wallet, chain, API utilities
    App.tsx              ->  main app component
    main.tsx             ->  entry point
  public/                ->  static assets
  index.html
  vite.config.ts
  tailwind.config.cjs
  vercel.json
```

---

<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=6,11,20&height=100&section=footer&animation=fadeIn" width="100%"/>

<div align="center">MIT License .... built by <a href="https://github.com/0xnurrabby">0xnurrabby</a></div>
