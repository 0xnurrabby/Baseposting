<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=6,11,20&height=180&section=header&text=BasePosting&fontSize=52&fontColor=fff&animation=twinkling&fontAlignY=32&desc=AI-powered%20Base%20post%20generator%20Farcaster%20mini%20app&descAlignY=55&descSize=14" width="100%" />

</div>

<div align="center">

**`// ðŸ“ BasePosting â€” AI-powered banger post generator on Base`**

> *"Stay consistent. Stay based. Post bangers."*

</div>

---

## `{ what_it_does }`

BasePosting is a Farcaster mini app that generates high-quality, on-brand social media posts for the Base ecosystem using AI. Connect your wallet, spend 3 credits, and get a ready-to-post banger for X â€” no writer's block, ever. It runs fully onchain on Base Mainnet with a credit system backed by smart contract interactions.

---

## `{ tech_stack }`

<div align="center">

**â—† LANGUAGES**

![TypeScript](https://img.shields.io/badge/TypeScript-B8F0D8?style=for-the-badge&logo=typescript&logoColor=1a1a1a)
![JavaScript](https://img.shields.io/badge/JavaScript-B3D9FF?style=for-the-badge&logo=javascript&logoColor=1a1a1a)
![HTML5](https://img.shields.io/badge/HTML5-FFF4A8?style=for-the-badge&logo=html5&logoColor=1a1a1a)
![CSS3](https://img.shields.io/badge/CSS3-FFD4A8?style=for-the-badge&logo=css3&logoColor=1a1a1a)

**â—† FRAMEWORKS & LIBRARIES**

![React](https://img.shields.io/badge/React-FFB3D9?style=for-the-badge&logo=react&logoColor=1a1a1a)
![Vite](https://img.shields.io/badge/Vite-FFB3B3?style=for-the-badge&logo=vite&logoColor=1a1a1a)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-D4B3FF?style=for-the-badge&logo=tailwindcss&logoColor=1a1a1a)
![Framer Motion](https://img.shields.io/badge/Framer_Motion-B8F0D8?style=for-the-badge&logo=framer&logoColor=1a1a1a)

**â—† WEB3 & BLOCKCHAIN**

![Base](https://img.shields.io/badge/Base-B3D9FF?style=for-the-badge&logo=coinbase&logoColor=1a1a1a)
![Viem](https://img.shields.io/badge/Viem-FFF4A8?style=for-the-badge&logo=ethereum&logoColor=1a1a1a)
![Farcaster](https://img.shields.io/badge/Farcaster_MiniApp-FFD4A8?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHBhdGggZmlsbD0iIzE3MTcxNyIgZD0iTTE2IDBDNy4xNiAwIDAgNy4xNiAwIDE2czguMTYgMTYgMTYgMTYgMTYtNy4xNiAxNi0xNlMyNC44NCAwIDE2IDB6Ii8+PC9zdmc+&logoColor=1a1a1a)

**â—† BACKEND & TOOLS**

![Vercel](https://img.shields.io/badge/Vercel-FFB3D9?style=for-the-badge&logo=vercel&logoColor=1a1a1a)
![Upstash Redis](https://img.shields.io/badge/Upstash_Redis-FFB3B3?style=for-the-badge&logo=redis&logoColor=1a1a1a)
![Vercel Blob](https://img.shields.io/badge/Vercel_Blob-D4B3FF?style=for-the-badge&logo=vercel&logoColor=1a1a1a)

</div>

---

## `{ features }`

![](https://img.shields.io/badge/âœ“-AI_Post_Generation_(-3_credits)-B8F0D8?style=flat-square&labelColor=1a1a1a)

![](https://img.shields.io/badge/âœ“-Onchain_Credit_System_on_Base_Mainnet-B3D9FF?style=flat-square&labelColor=1a1a1a)

![](https://img.shields.io/badge/âœ“-Farcaster_Mini_App_Integration-FFF4A8?style=flat-square&labelColor=1a1a1a)

![](https://img.shields.io/badge/âœ“-Multi--wallet_Support_(MetaMask,_Rabby,_OKX,_Bitget...)-FFD4A8?style=flat-square&labelColor=1a1a1a)

![](https://img.shields.io/badge/âœ“-One--click_Post_to_X_(Twitter)-FFB3D9?style=flat-square&labelColor=1a1a1a)

![](https://img.shields.io/badge/âœ“-Share_for_6_Credits_Daily_Bonus-FFB3B3?style=flat-square&labelColor=1a1a1a)

![](https://img.shields.io/badge/âœ“-Global_Leaderboard-D4B3FF?style=flat-square&labelColor=1a1a1a)

![](https://img.shields.io/badge/âœ“-USDC_Tip_Support_on_Base-B8F0D8?style=flat-square&labelColor=1a1a1a)

![](https://img.shields.io/badge/âœ“-Dark_/_Light_Theme-B3D9FF?style=flat-square&labelColor=1a1a1a)

---

## `{ quick_start }`

```bash
git clone https://github.com/0xnurrabby/Baseposting
cd Baseposting
npm install
npm run dev
```

> **Required env vars** â€” create a `.env` file:

```env
VITE_TIP_RECIPIENT=0xYourWalletAddress
UPSTASH_REDIS_REST_URL=your_upstash_url
UPSTASH_REDIS_REST_TOKEN=your_upstash_token
```

> **Deploy to Vercel:**

```bash
npm run build
# push to GitHub and import in vercel.com
# Vercel auto-detects vite + runs "npm run build" â†’ outputs /dist
```

---

## `{ project_structure }`

```
Baseposting/
â”œâ”€â”€ api/                  # Vercel serverless functions
â”‚   â”œâ”€â”€ generate.ts       # AI post generation endpoint
â”‚   â”œâ”€â”€ generate-image.ts # Image generation (temp disabled)
â”‚   â”œâ”€â”€ leaderboard.ts    # Leaderboard data
â”‚   â”œâ”€â”€ verify-tx.ts      # Onchain tx verification
â”‚   â””â”€â”€ notif/            # Farcaster notification handlers
â”œâ”€â”€ src/
â”‚   â”œâ”€â”€ components/       # React UI components
â”‚   â”‚   â”œâ”€â”€ Button.tsx
â”‚   â”‚   â”œâ”€â”€ Card.tsx
â”‚   â”‚   â”œâ”€â”€ LeaderboardPage.tsx
â”‚   â”‚   â””â”€â”€ ...
â”‚   â”œâ”€â”€ lib/              # Wallet, chain, API utils
â”‚   â”œâ”€â”€ App.tsx           # Main app component
â”‚   â””â”€â”€ main.tsx          # Entry point
â”œâ”€â”€ public/               # Static assets
â”œâ”€â”€ index.html
â”œâ”€â”€ vite.config.ts
â”œâ”€â”€ tailwind.config.cjs
â””â”€â”€ vercel.json
```

---

## `{ connect }`

<div align="center">

[![X (Twitter)](https://img.shields.io/badge/X_(Twitter)-@nurw3b-B8F0D8?style=for-the-badge&logo=x&logoColor=1a1a1a&labelColor=1a1a1a)](https://x.com/nurw3b)

[![Telegram](https://img.shields.io/badge/Telegram-@nurrabby-B3D9FF?style=for-the-badge&logo=telegram&logoColor=1a1a1a&labelColor=1a1a1a)](https://t.me/nurrabby)

[![GitHub](https://img.shields.io/badge/GitHub-0xnurrabby-FFD4A8?style=for-the-badge&logo=github&logoColor=1a1a1a&labelColor=1a1a1a)](https://github.com/0xnurrabby)

</div>

---

<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=6,11,20&height=100&section=footer" width="100%" />

</div>
