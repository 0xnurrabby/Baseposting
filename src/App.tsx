import React, { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Copy, Moon, Send, Sparkles, Sun, Wallet, HandCoins, X, Image as ImageIcon, Palette } from 'lucide-react'
import { getAddress, isAddress, parseUnits, encodeFunctionData, keccak256, toHex } from 'viem'

import { Card, CardContent, CardHeader } from '@/components/Card'
import { Button } from '@/components/Button'
import { Skeleton } from '@/components/Skeleton'
import { RoadmapBell } from '@/components/RoadmapBell'
import { LeaderboardPage } from '@/components/LeaderboardPage'
import { LeaderboardIcon } from '@/components/LeaderboardIcon'
import { apiGenerate, apiGenerateImage, apiMe, apiShareAward, apiVerifyTx, type Identity } from '@/lib/api'
import { composeCast, connectWalletProvider, getEthereumProvider, hapticImpact, hapticSelection, initMiniApp, listAvailableWallets, type WalletOption } from '@/lib/miniapp'

const CONTRACT = '0xB331328F506f2D35125e367A190e914B1b6830cF'

const LOG_ACTION_ABI = [
  {
    type: 'function',
    name: 'logAction',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'action', type: 'bytes32' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
] as const

const SITE_URL = import.meta.env.VITE_PUBLIC_SITE_URL || window.location.origin
const WALLET_CREDIT_KEY = 'bp_credits_cache_v1'
const PENDING_TX_KEY = 'bp_pending_tx_v1'

const SHARE_COPY_TEMPLATES = [
  'Okay this is actually useful 💙 I used to get stuck every day thinking: “What should I post on Base?” 😵‍💫 Now I just open BasePosting — one tap gives banger post ideas + images in seconds. Try it: {url}',
  'Creators on Base: this is your cheat code ⚡️ BasePosting gives post ideas + images in seconds. Try it: {url}',
  'Posting on Base got 10x easier. Open BasePosting → pick an idea → post ✅ {url}',
  'Stop overthinking your next Base post 😮‍💨 BasePosting spits out viral post ideas + images instantly. {url}',
  'Found a tool that makes posting on Base effortless 🧠✨ BasePosting = ideas + images in seconds. {url}',
  'Hot tip: if you’re stuck on what to post on Base, use BasePosting 💙 instant ideas + visuals. {url}',
  'Need a Base post right now? BasePosting → one tap → done 🚀 {url}',
  'BasePosting is kinda unfair 😅 It generates banger post ideas + images for Base in seconds. {url}',
  'If you post on Base, you want this. BasePosting gives banger ideas + images in seconds 🔥 {url}',
]

function normalizeSiteUrl(siteUrl: string) {
  const url = siteUrl?.trim?.() || ''
  if (!url) return ''
  return url.endsWith('/') ? url : `${url}/`
}

function randInt(maxExclusive: number) {
  if (maxExclusive <= 1) return 0
  try {
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    return buf[0] % maxExclusive
  } catch {
    return Math.floor(Math.random() * maxExclusive)
  }
}

function getRotatingShareCopy(siteUrl: string) {
  const url = normalizeSiteUrl(siteUrl)
  if (!url) return ''

  const storageKey = 'bp_share_copy_pool_v1'
  let pool: number[] = []

  try {
    const raw = localStorage.getItem(storageKey)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    if (Array.isArray(parsed) && parsed.every((n) => Number.isInteger(n))) {
      pool = parsed as number[]
    }
  } catch {
    // ignore
  }

  if (pool.length === 0) {
    pool = Array.from({ length: SHARE_COPY_TEMPLATES.length }, (_, i) => i)
    for (let i = pool.length - 1; i > 0; i--) {
      const j = randInt(i + 1)
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
  }

  const idx = pool.pop() ?? 0
  try {
    localStorage.setItem(storageKey, JSON.stringify(pool))
  } catch {
    // ignore
  }

  return SHARE_COPY_TEMPLATES[idx]?.replace('{url}', url) ?? `Try it: ${url}`
}

const USDC_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const USDC_DECIMALS = 6
const RECIPIENT =
  import.meta.env.VITE_TIP_RECIPIENT ||
  '0xe8Bda2Ed9d2FC622D900C8a76dc455A3e79B041f'
const PAYMASTER_SERVICE_URL = (import.meta.env.VITE_PAYMASTER_SERVICE_URL || '').trim()

function isUserRejection(e: any) {
  const msg = String(e?.message || '').toLowerCase()
  return e?.code === 4001 || msg.includes('user rejected') || msg.includes('rejected') || msg.includes('denied')
}

function isMethodNotSupported(e: any) {
  const msg = String(e?.message || '').toLowerCase()
  return (
    e?.code === -32601 ||
    msg.includes('method not found') ||
    msg.includes('does not support the requested method') ||
    msg.includes('unsupported method') ||
    msg.includes('not supported')
  )
}

function isInvalidParamsOrCapability(e: any) {
  const msg = String(e?.message || '').toLowerCase()
  return (
    e?.code === -32602 ||
    msg.includes('invalid params') ||
    msg.includes('capabilities') ||
    msg.includes('datasuffix') ||
    msg.includes('unknown field') ||
    msg.includes('unexpected') ||
    msg.includes('unsupported capability')
  )
}

function isHexString(value: any): value is `0x${string}` {
  return typeof value === 'string' && /^0x[0-9a-fA-F]*$/.test(value)
}

function appendCalldataSuffix(data: `0x${string}`, suffix?: string | null): `0x${string}` {
  if (!suffix) return data
  if (!isHexString(suffix)) return data
  if (((suffix.length - 2) % 2) !== 0) return data
  if (suffix === '0x') return data
  if (data === '0x') return suffix
  return (data + suffix.slice(2)) as `0x${string}`
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text)
}

function shortAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function pad32(hexNo0x: string) {
  return hexNo0x.replace(/^0x/, '').padStart(64, '0')
}

function encodeErc20Transfer(recipient: string, amount: bigint) {
  const selector = 'a9059cbb'
  const to = pad32(recipient)
  const val = pad32(amount.toString(16))
  return `0x${selector}${to}${val}`
}

function raceWithTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let done = false
    const t = setTimeout(() => {
      if (done) return
      done = true
      resolve(fallback)
    }, ms)
    p.then((v) => {
      if (done) return
      done = true
      clearTimeout(t)
      resolve(v)
    }).catch(() => {
      if (done) return
      done = true
      clearTimeout(t)
      resolve(fallback)
    })
  })
}

// ---------------------------------------------------------------------------
// LoadingLabel — memoized; no hooks running when idle.
// ---------------------------------------------------------------------------
const LoadingLabel = React.memo(function LoadingLabel(props: {
  active: boolean
  estimateSec: number
  idleText: string
  icon?: React.ReactNode
  loadingText?: string
}) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!props.active) {
      setElapsed(0)
      return
    }
    const startedAt = Date.now()
    const t = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 500)
    return () => clearInterval(t)
  }, [props.active])

  if (!props.active) {
    return (
      <>
        {props.icon}
        {props.idleText}
      </>
    )
  }

  const remaining = Math.max(0, props.estimateSec - elapsed)
  const base = props.loadingText || 'Cooking'
  const label =
    elapsed < 2
      ? 'Starting…'
      : remaining > 0
        ? `${base}… ~${remaining}s left`
        : 'Finalizing, almost there…'
  const progress = Math.min(0.98, elapsed / Math.max(1, props.estimateSec))

  return (
    <span className="relative flex w-full items-center justify-center gap-2 overflow-hidden">
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 rounded-full bg-white/15 transition-[width] duration-500 ease-out"
        style={{ width: `${Math.round(progress * 100)}%` }}
      />
      <span className="relative flex items-center gap-1.5">
        <span className="h-2 w-2 animate-pulse rounded-full bg-current opacity-70" />
        <span className="h-2 w-2 animate-pulse rounded-full bg-current opacity-70 [animation-delay:150ms]" />
        <span className="h-2 w-2 animate-pulse rounded-full bg-current opacity-70 [animation-delay:300ms]" />
      </span>
      <span className="relative ml-1 text-sm font-semibold">{label}</span>
    </span>
  )
})

export default function App() {
  const [mounted, setMounted] = useState(false)
  const [dark, setDark] = useState(true)

  const [miniLoaded, setMiniLoaded] = useState(false)
  const [isInMiniApp, setIsInMiniApp] = useState(false)
  const [capabilities, setCapabilities] = useState<string[]>([])
  const [miniClient, setMiniClient] = useState<any | null>(null)

  const bootAppliedRef = useRef(false)

  const [identity, setIdentity] = useState<Identity>({})
  const [view, setView] = useState<'home' | 'leaderboard'>('home')
  const [credits, setCredits] = useState<number | null>(null)
  const [shareEligible, setShareEligible] = useState<boolean>(false)
  const [todayUtc, setTodayUtc] = useState<string>('')
  const shareAwardInFlight = useRef(false)

  const [result, setResult] = useState<string>('')
  const [imageUrl, setImageUrl] = useState<string>('')
  const [imageId, setImageId] = useState<string>('')
  const [imageError, setImageError] = useState(false)
  const [generatingImage, setGeneratingImage] = useState(false)

  const PHOTO_STYLE_KEY = 'bp_photo_style_preset_v1'
  const [photoStyleOpen, setPhotoStyleOpen] = useState(false)
  const [photoStylePreset, setPhotoStylePreset] = useState<string | null>(null)

  const [loadingMe, setLoadingMe] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [posting, setPosting] = useState(false)
  const [sharing, setSharing] = useState(false)

  // Get-Credit flow: we distinguish 2 phases now so the button is never "dead".
  //   submittingCredit = user is confirming the tx in the wallet
  //   verifyingCredit  = tx submitted, we are polling the chain / our backend
  const [submittingCredit, setSubmittingCredit] = useState(false)
  const [verifyingCredit, setVerifyingCredit] = useState(false)

  const verifyInFlight = useRef<string>('')

  const [walletConnecting, setWalletConnecting] = useState(false)
  const [walletModalOpen, setWalletModalOpen] = useState(false)
  const [walletOptions, setWalletOptions] = useState<WalletOption[]>([])
  const [selectedWalletId, setSelectedWalletId] = useState('')

  const [tipOpen, setTipOpen] = useState(false)
  const [tipUsd, setTipUsd] = useState('500')
  const [tipStage, setTipStage] = useState<'idle' | 'preparing' | 'confirm' | 'sending' | 'done'>('idle')

  const PENDING_TOAST_KEY = 'bp_pending_toast_v1'
  const PENDING_SHARE_AWARD_KEY = 'bp_pending_share_award_v1'

  function setPendingToast(kind: 'success' | 'message' | 'error', text: string) {
    try {
      sessionStorage.setItem(PENDING_TOAST_KEY, JSON.stringify({ kind, text, ts: Date.now() }))
    } catch {
      // ignore
    }
  }

  function toAbsoluteUrl(maybeRelative: string) {
    const raw = String(maybeRelative || '').trim()
    if (!raw) return ''
    try {
      const base = raw.startsWith('/') ? window.location.origin : SITE_URL
      return new URL(raw, base).toString()
    } catch {
      return raw
    }
  }

  const walletConnected = Boolean(identity.address)
  const canGenerate = useMemo(() => !generating && miniLoaded && walletConnected, [generating, miniLoaded, walletConnected])

  const PHOTO_STYLE_OPTIONS = useMemo(
    () =>
      [
        { key: 'storybook', label: 'Storybook', desc: "Hand-drawn, kids-book watercolor (default vibe)" },
        { key: 'modern', label: 'Modern', desc: 'Clean, minimal, editorial illustration' },
        { key: 'realistic', label: 'Realistic', desc: 'Photoreal look (natural light)' },
        { key: 'cinematic', label: 'Cinematic', desc: 'Dramatic lighting, depth, movie still' },
        { key: 'anime', label: 'Anime', desc: 'Anime illustration, clean lines, soft shading' },
        { key: 'comic', label: 'Comic', desc: 'Comic book / inked outlines, punchy shadows' },
        { key: 'pixel', label: 'Pixel', desc: 'Pixel art, retro game style' },
        { key: 'isometric', label: 'Isometric', desc: 'Isometric world / diorama' },
        { key: 'clay', label: 'Clay', desc: 'Claymation / soft 3D clay look' },
        { key: '3d', label: '3D Render', desc: 'Tasteful 3D render (not plastic)' },
        { key: 'noir', label: 'Noir', desc: 'Black & white noir, moody contrast' },
        { key: 'cyberpunk', label: 'Cyberpunk', desc: 'Neon sci-fi city vibe (controlled)' },
        { key: 'vaporwave', label: 'Vaporwave', desc: 'Retro-futuristic gradients + glow' },
        { key: 'oil', label: 'Oil Painting', desc: 'Classic oil paint strokes' },
        { key: 'watercolor', label: 'Watercolor', desc: 'Soft watercolor wash, paper texture' },
        { key: 'pencil', label: 'Pencil Sketch', desc: 'Graphite sketch / cross-hatching' },
        { key: 'ink', label: 'Ink Wash', desc: 'Ink wash + brush texture' },
        { key: 'lowpoly', label: 'Low Poly', desc: 'Low-poly geometric 3D' },
      ] as const,
    []
  )

  const photoStyleLabel = useMemo(() => {
    if (!photoStylePreset) return 'Default (from env)'
    const f = PHOTO_STYLE_OPTIONS.find((o) => o.key === photoStylePreset)
    return f ? f.label : photoStylePreset
  }, [photoStylePreset, PHOTO_STYLE_OPTIONS])

  function setAndPersistPhotoStyle(next: string | null) {
    setPhotoStylePreset(next)
    try {
      if (!next) localStorage.removeItem(PHOTO_STYLE_KEY)
      else localStorage.setItem(PHOTO_STYLE_KEY, next)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    setMounted(true)
    const stored = localStorage.getItem('bp_theme')
    setDark(stored ? stored === 'dark' : true)

    try {
      const walletId = localStorage.getItem('bp_wallet_choice_v2') || ''
      if (walletId) setSelectedWalletId(walletId)
    } catch {
      // ignore
    }

    try {
      const raw = localStorage.getItem(WALLET_CREDIT_KEY)
      const cached = raw ? JSON.parse(raw) : null
      if (cached && Number.isFinite(Number(cached.credits))) setCredits(Number(cached.credits))
    } catch {
      // ignore
    }

    const ps = localStorage.getItem(PHOTO_STYLE_KEY)
    if (ps && typeof ps === 'string') setPhotoStylePreset(ps)
  }, [])

  useEffect(() => {
    try {
      if (identity.address && credits != null) {
        localStorage.setItem(WALLET_CREDIT_KEY, JSON.stringify({ address: identity.address.toLowerCase(), credits, ts: Date.now() }))
      }
    } catch {
      // ignore
    }
  }, [identity.address, credits])

  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState !== 'visible') return

      setSharing(false)
      setPosting(false)

      if (miniLoaded && identity.address) {
        void (async () => {
          let handledShareAward = false
          try {
            const pending = sessionStorage.getItem(PENDING_SHARE_AWARD_KEY)
            if (pending && !shareAwardInFlight.current) {
              sessionStorage.removeItem(PENDING_SHARE_AWARD_KEY)
              shareAwardInFlight.current = true
              handledShareAward = true
              setCredits((prev) => Math.max(0, (prev ?? 0) + 6))
              const award = await apiShareAward(identity)
              setCredits(award.credits)
              setShareEligible(false)
              setTodayUtc(award.todayUtc)
              toast.success(award.alreadyClaimed ? 'Already claimed today' : '+6 credits added 💙')
            }
          } catch {
            // ignore
          } finally {
            shareAwardInFlight.current = false
          }

          if (!handledShareAward) {
            try {
              const me = await apiMe(identity)
              setCredits(me.user.credits)
              setShareEligible(me.share.canClaimToday)
              setTodayUtc(me.share.todayUtc)
            } catch {
              // ignore
            }
          }
        })()
      }

      try {
        const raw = sessionStorage.getItem(PENDING_TOAST_KEY)
        if (!raw) return
        sessionStorage.removeItem(PENDING_TOAST_KEY)
        const data = JSON.parse(raw)
        const msg = String(data?.text || '').trim()
        if (!msg) return
        const kind = String(data?.kind || 'message')
        if (kind === 'success') toast.success(msg)
        else if (kind === 'error') toast.error(msg)
        else toast.message(msg)
      } catch {
        // ignore
      }
    }

    document.addEventListener('visibilitychange', onReturn)
    window.addEventListener('focus', onReturn)
    return () => {
      document.removeEventListener('visibilitychange', onReturn)
      window.removeEventListener('focus', onReturn)
    }
  }, [identity.address, miniLoaded])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('src') !== 'notif') return

    const fid = Number(params.get('fid'))
    const appFid = Number(params.get('appFid'))
    const nid = params.get('nid') || ''

    if (Number.isFinite(fid) && Number.isFinite(appFid)) {
      fetch('/api/notif/opened', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fid, appFid, nid }),
        keepalive: true,
      }).catch(() => {})
    }

    params.delete('src')
    params.delete('fid')
    params.delete('appFid')
    params.delete('nid')
    const qs = params.toString()
    const clean = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash
    window.history.replaceState({}, '', clean)
  }, [])

  useEffect(() => {
    if (!mounted) return
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('bp_theme', dark ? 'dark' : 'light')
  }, [dark, mounted])

  useEffect(() => {
    if (!tipOpen) return
    if (tipStage !== 'done') return
    const t = setTimeout(() => {
      closeTip()
      toast.success('Thank you for the tip 💙 Appreciate you!')
    }, 1700)
    return () => clearTimeout(t)
  }, [tipOpen, tipStage])

  // ==========================================================================
  // BOOT
  // ==========================================================================
  useEffect(() => {
    let cancelled = false

    const applyState = (state: any) => {
      if (cancelled || bootAppliedRef.current) return
      bootAppliedRef.current = true
      setIsInMiniApp(Boolean(state?.isInMiniApp))
      setCapabilities(Array.isArray(state?.capabilities) ? state.capabilities : [])
      setMiniClient(state?.client || null)
      setMiniLoaded(true)
    }

    const boot = async () => {
      const timeoutFallback = new Promise<any>((resolve) =>
        setTimeout(() => resolve({ isInMiniApp: false, capabilities: [], user: null, client: null }), 1500)
      )

      const winner = await Promise.race([initMiniApp(), timeoutFallback])
      applyState(winner)

      let realState: any = winner
      try {
        realState = await Promise.race([
          initMiniApp(),
          new Promise<any>((resolve) => setTimeout(() => resolve(winner), 3000)),
        ])
      } catch {
        realState = winner
      }

      if (cancelled) return

      try {
        if (realState?.isInMiniApp) {
          const wallets = await raceWithTimeout(
            listAvailableWallets({ isInMiniApp: true, client: realState.client }),
            2500,
            [] as WalletOption[]
          )
          const host = wallets.find((w) => w.source === 'miniapp') || wallets[0]
          if (host && !cancelled) {
            try {
              const { address } = await raceWithTimeout(
                connectWalletProvider(host, { isInMiniApp: true, client: realState.client }),
                4000,
                { address: '' } as any
              )
              if (address && !cancelled) {
                setIdentity({ address })
                setSelectedWalletId(host.id)
                try {
                  localStorage.setItem('bp_wallet_choice_v2', host.id)
                } catch {
                  // ignore
                }
              }
            } catch {
              // user will tap Connect Wallet
            }
          }
        }
      } catch {
        // ignore
      }
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const load = async () => {
      if (!miniLoaded) return
      if (!identity.address) return

      setLoadingMe(true)
      try {
        const me = await apiMe(identity)
        setCredits(me.user.credits)
        setShareEligible(me.share.canClaimToday)
        setTodayUtc(me.share.todayUtc)
      } catch (e: any) {
        toast.error(e?.message || 'Failed to load credits')
      } finally {
        setLoadingMe(false)
      }
    }

    void load()
  }, [identity.address, miniLoaded])

  // ==========================================================================
  // RESUMABLE TX VERIFY
  // ==========================================================================

  function savePendingTx(txHash: string, addr: string) {
    try {
      localStorage.setItem(
        PENDING_TX_KEY,
        JSON.stringify({ txHash, address: addr.toLowerCase(), ts: Date.now() })
      )
    } catch {
      // ignore
    }
  }

  function clearPendingTx() {
    try {
      localStorage.removeItem(PENDING_TX_KEY)
    } catch {
      // ignore
    }
  }

  function readPendingTx(): { txHash: string; address: string; ts: number } | null {
    try {
      const raw = localStorage.getItem(PENDING_TX_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (!parsed?.txHash || !parsed?.address) return null
      if (Date.now() - Number(parsed.ts || 0) > 2 * 60 * 60 * 1000) {
        clearPendingTx()
        return null
      }
      return parsed
    } catch {
      return null
    }
  }

  async function verifyCreditTxInBackground(id: Identity, txHash: string) {
    if (verifyInFlight.current === txHash) return
    verifyInFlight.current = txHash
    setVerifyingCredit(true)

    const pollMs = 2500
    let softNoticeShown = false

    try {
      // Try for ~3 minutes (72 polls × 2.5s), then stop the visible "verifying"
      // indicator but still keep checking silently on next app open.
      let attempts = 0
      const maxVisibleAttempts = 72

      while (true) {
        attempts++
        try {
          const out = await apiVerifyTx(id, txHash)
          if (!out.pending) {
            setCredits(out.credits)
            toast.success(out.alreadyCounted ? 'Credit already added' : 'Txn verified. +1 credit added 💙')
            clearPendingTx()
            return out
          }
        } catch (e: any) {
          const msg = String(e?.message || '').toLowerCase()
          const retriable =
            e?.name === 'AbortError' ||
            msg.includes('timed out') ||
            msg.includes('failed to fetch') ||
            msg.includes('networkerror') ||
            msg.includes('load failed') ||
            msg.includes('aborted')
          if (!retriable) {
            clearPendingTx()
            throw e
          }
        }

        if (!softNoticeShown && attempts >= 4) {
          softNoticeShown = true
          toast.message('Still confirming onchain. You can close the app — credit will be added automatically.')
        }

        if (attempts >= maxVisibleAttempts) {
          // Give up the visible spinner but don't clear storage — next app open
          // will resume.
          return
        }

        await new Promise((r) => setTimeout(r, pollMs))
      }
    } finally {
      if (verifyInFlight.current === txHash) {
        verifyInFlight.current = ''
      }
      setVerifyingCredit(false)
    }
  }

  useEffect(() => {
    if (!miniLoaded || !identity.address) return
    const pending = readPendingTx()
    if (!pending) return
    if (pending.address !== identity.address.toLowerCase()) return
    void verifyCreditTxInBackground({ address: identity.address }, pending.txHash)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [miniLoaded, identity.address])

  async function onCreateWallet() {
    await openWalletPicker()
  }

  async function openWalletPicker() {
    setWalletConnecting(true)
    try {
      const found = await listAvailableWallets({ isInMiniApp, client: miniClient })
      const seen = new Set<string>()
      const clean = found.filter((w) => {
        const key = `${w.source}:${(w.providerKey || w.rdns || w.name).toLowerCase()}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      setWalletOptions(clean)
      setWalletModalOpen(true)
      if (!clean.length) {
        toast.error('No wallet found. Open this app in Base, Trust, MetaMask, Rabby, OKX, or another wallet-enabled browser.')
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to detect wallets')
    } finally {
      setWalletConnecting(false)
    }
  }

  async function ensureWalletIdentity() {
    if (identity.address) return identity.address
    await openWalletPicker()
    return null
  }

  async function connectWallet(option: WalletOption) {
    setWalletConnecting(true)
    try {
      await hapticSelection(capabilities)
      const { address: addr } = await connectWalletProvider(option, { isInMiniApp, client: miniClient })
      const nextIdentity: Identity = { address: addr }
      setIdentity(nextIdentity)
      setSelectedWalletId(option.id)
      try {
        localStorage.setItem('bp_wallet_choice_v2', option.id)
      } catch {
        // ignore
      }
      setWalletModalOpen(false)

      setLoadingMe(true)
      try {
        const me = await apiMe(nextIdentity)
        setCredits(me.user.credits)
        setShareEligible(me.share.canClaimToday)
        setTodayUtc(me.share.todayUtc)
      } catch {
        setCredits((prev) => (prev == null ? 1 : prev))
      } finally {
        setLoadingMe(false)
      }

      toast.success(`${option.name} connected`)
      return addr
    } catch (e: any) {
      if (isUserRejection(e)) {
        toast.message('Wallet connection cancelled')
      } else {
        toast.error(e?.message || 'Failed to connect wallet')
      }
      return null
    } finally {
      setWalletConnecting(false)
    }
  }

  async function refreshMe() {
    if (!identity.address) return
    try {
      const me = await apiMe(identity)
      setCredits(me.user.credits)
      setShareEligible(me.share.canClaimToday)
      setTodayUtc(me.share.todayUtc)
    } catch {
      // ignore
    }
  }

  async function onGenerate(_isRegen = false) {
    if (!canGenerate) return

    let id: Identity = identity
    if (!id.address) {
      const addr = await ensureWalletIdentity()
      if (!addr) return
      id = { address: addr }
    }

    const currentCredits = credits ?? 1
    if (currentCredits < 1) {
      toast.error('No credits left')
      return
    }

    setGenerating(true)
    setResult('')
    setImageUrl('')
    try {
      await hapticImpact(capabilities, 'medium')
      const out = await apiGenerate(id, '')
      setResult(out.text)
      setCredits(out.credits)
      toast.success('Cooked :)')
    } catch (e: any) {
      const status = (e as any)?.status
      if (status === 402) {
        setCredits((e as any)?.data?.credits ?? 0)
        toast.error('No credits left')
      } else {
        toast.error(e?.message || 'Generation failed')
      }
    } finally {
      setGenerating(false)
    }
  }

  async function onGeneratePhoto() {
    if (!result) {
      toast.message('Generate a Basepost first')
      return
    }

    let id: Identity = identity
    if (!id.address) {
      const addr = await ensureWalletIdentity()
      if (!addr) return
      id = { address: addr }
    }

    const currentCredits = credits ?? 5
    if (currentCredits < 5) {
      toast.error('Need 5 credits for a photo')
      return
    }

    setGeneratingImage(true)
    setImageUrl('')
    setImageId('')
    setImageError(false)
    try {
      await hapticImpact(capabilities, 'medium')
      const out = await apiGenerateImage(id, result, photoStylePreset || undefined)
      const path = out.imageDataUrl || out.imageUrl || (out.imageId ? `/api/image?id=${encodeURIComponent(out.imageId)}` : '')
      setImageUrl(toAbsoluteUrl(path))
      setImageId(out.imageId || '')
      setCredits(out.credits)
      toast.success('Photo ready 📸')
    } catch (e: any) {
      const status = (e as any)?.status
      if (status === 402) {
        setCredits((e as any)?.data?.credits ?? 0)
        toast.error('Not enough credits')
      } else {
        toast.error(e?.message || 'Image generation failed')
      }
    } finally {
      setGeneratingImage(false)
    }
  }

  async function onCopy() {
    if (!result) return
    try {
      await hapticSelection(capabilities)
      await copyText(result)
      toast.success('Copied')
    } catch {
      toast.error('Copy failed')
    }
  }

  async function onPostDirectly() {
    if (!result) return
    setPosting(true)
    try {
      await hapticImpact(capabilities, 'light')
      setPendingToast('success', 'Welcome back ✅')
      const embed = imageUrl?.startsWith('http')
        ? imageUrl
        : imageId
          ? `${SITE_URL}/api/image?id=${encodeURIComponent(imageId)}`
          : ''
      void composeCast({ text: result, embeds: embed ? [embed] : undefined })
    } catch (e: any) {
      if (isUserRejection(e)) return toast.message('Post cancelled')
      toast.error(e?.message || 'Failed to open composer')
    } finally {
      setPosting(false)
    }
  }

  async function onShareForCredits() {
    if (!shareEligible) {
      toast.message('Share bonus already claimed today')
      return
    }
    setSharing(true)
    try {
      await hapticImpact(capabilities, 'medium')
      const shareUrl = normalizeSiteUrl(SITE_URL)
      const shareText = getRotatingShareCopy(SITE_URL)
      setPendingToast('message', 'Welcome back ✅ Adding your share bonus…')
      try {
        sessionStorage.setItem(PENDING_SHARE_AWARD_KEY, '1')
      } catch {
        // ignore
      }
      void composeCast({ text: shareText, embeds: shareUrl ? [shareUrl] : undefined })

      const awardIfPending = async () => {
        try {
          setCredits((prev) => Math.max(0, (prev ?? 0) + 6))
          const award = await apiShareAward(identity)
          setCredits(award.credits)
          setShareEligible(false)
          setTodayUtc(award.todayUtc)
          toast.success(award.alreadyClaimed ? 'Already claimed today' : '+6 credits added 💙')
        } catch {
          // ignore
        }
      }
      setTimeout(() => {
        try {
          if (document.visibilityState !== 'visible') return
          const pending = sessionStorage.getItem(PENDING_SHARE_AWARD_KEY)
          if (!pending) return
          sessionStorage.removeItem(PENDING_SHARE_AWARD_KEY)
          void awardIfPending()
        } catch {
          // ignore
        }
      }, 900)
    } catch (e: any) {
      if (isUserRejection(e)) return toast.message('Share cancelled')
      toast.error(e?.message || 'Share failed')
    } finally {
      setSharing(false)
    }
  }

  async function onGetCredit() {
    if (submittingCredit || verifyingCredit) return

    setSubmittingCredit(true)
    try {
      const addr = await ensureWalletIdentity()
      if (!addr) {
        setSubmittingCredit(false)
        return
      }

      await hapticImpact(capabilities, 'medium')
      const provider: any = await getEthereumProvider(selectedWalletId, { isInMiniApp, client: miniClient })

      const chainId = (await provider.request({ method: 'eth_chainId' })) as string
      if (chainId !== '0x2105') {
        try {
          await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x2105' }],
          })
        } catch {
          throw new Error('Please switch to Base Mainnet (0x2105) in your wallet to continue.')
        }
      }

      const dataSuffix = (window as any).__ERC8021_DATA_SUFFIX__

      let paymasterSupported = false
      if (PAYMASTER_SERVICE_URL) {
        try {
          const caps = await provider.request({ method: 'wallet_getCapabilities', params: [addr] })
          paymasterSupported = Boolean(caps?.['0x2105']?.paymasterService?.supported)
        } catch {
          paymasterSupported = false
        }
      }

      const action = keccak256(toHex('BASEPOSTING_GET_CREDIT'))
      const payload = toHex(
        JSON.stringify({ address: addr, ts: Date.now(), app: 'BasePosting' })
      )

      const data = encodeFunctionData({
        abi: LOG_ACTION_ABI,
        functionName: 'logAction',
        args: [action, payload],
      })

      const dataWithSuffix = appendCalldataSuffix(data as `0x${string}`, dataSuffix)
      const callCapabilities: any = {
        ...(dataSuffix ? { dataSuffix: { value: dataSuffix, optional: true } } : {}),
        ...(paymasterSupported ? { paymasterService: { url: PAYMASTER_SERVICE_URL } } : {}),
      }

      const callsPayloadWithCaps: any = {
        version: '2.0.0',
        from: addr,
        chainId: '0x2105',
        atomicRequired: true,
        calls: [{ to: CONTRACT, value: '0x0', data }],
        ...(Object.keys(callCapabilities).length ? { capabilities: callCapabilities } : {}),
      }

      const callsPayloadNoCaps: any = {
        version: '2.0.0',
        from: addr,
        chainId: '0x2105',
        atomicRequired: true,
        calls: [{ to: CONTRACT, value: '0x0', data: dataWithSuffix }],
      }

      let txHash = ''
      try {
        let sendRes: any
        try {
          sendRes = await provider.request({ method: 'wallet_sendCalls', params: [callsPayloadWithCaps] })
        } catch (e: any) {
          if (isInvalidParamsOrCapability(e)) {
            sendRes = await provider.request({ method: 'wallet_sendCalls', params: [callsPayloadNoCaps] })
          } else {
            throw e
          }
        }

        const confirmationId =
          typeof sendRes === 'string'
            ? sendRes
            : sendRes?.callsId || sendRes?.batchId || sendRes?.id || sendRes?.result || sendRes?.hash

        if (!confirmationId || typeof confirmationId !== 'string') {
          throw new Error('wallet_sendCalls did not return a valid confirmation id.')
        }

        toast.message('Transaction submitted. Verifying on-chain…')
        txHash = /^0x[a-fA-F0-9]{64}$/.test(confirmationId)
          ? confirmationId
          : await waitForCallsTxHash(provider, confirmationId, { timeoutMs: 20000, pollMs: 1200 })
      } catch (e: any) {
        if (!isMethodNotSupported(e)) throw e

        const balHex = (await provider.request({ method: 'eth_getBalance', params: [addr, 'latest'] })) as string
        if (BigInt(balHex) === 0n) {
          throw new Error(
            'Your wallet provider in this host does not support wallet_sendCalls, and your account has 0 Base ETH for gas. Add a little ETH on Base and retry.',
          )
        }

        const tx = { from: addr, to: CONTRACT, value: '0x0', data: dataWithSuffix }
        txHash = (await provider.request({ method: 'eth_sendTransaction', params: [tx] })) as string
        toast.message('Transaction submitted. Verifying on-chain…')
      }

      savePendingTx(txHash, addr)

      // Transition from "submitting" -> "verifying" phase
      setSubmittingCredit(false)
      await verifyCreditTxInBackground({ address: addr }, txHash)
    } catch (e: any) {
      if (isUserRejection(e)) {
        toast.message('Transaction cancelled')
      } else {
        toast.error(e?.message || 'Transaction failed')
      }
      setSubmittingCredit(false)
      setVerifyingCredit(false)
    }
  }

  async function waitForCallsTxHash(
    provider: any,
    callsId: string,
    opts: { timeoutMs?: number; pollMs?: number } = {},
  ) {
    const timeoutMs = opts.timeoutMs ?? 15000
    const pollMs = opts.pollMs ?? 800
    const started = Date.now()

    while (Date.now() - started < timeoutMs) {
      let status: any
      try {
        status = await provider.request({ method: 'wallet_getCallsStatus', params: [callsId] })
      } catch (e: any) {
        if (e?.code === 4100) {
          throw new Error('Your wallet does not support wallet_getCallsStatus, so we cannot verify this batch transaction.')
        }
        throw e
      }

      const code = Number(status?.status)
      if (code === 100) {
        await new Promise((r) => setTimeout(r, pollMs))
        continue
      }

      if (code === 200) {
        const receipts = status?.receipts
        const first = Array.isArray(receipts) ? receipts[0] : receipts
        const txHash = first?.transactionHash
        if (!txHash) throw new Error('Batch confirmed, but no transactionHash was returned by the wallet.')
        return txHash as string
      }

      throw new Error(`Batch failed (status ${isNaN(code) ? String(status?.status) : code}).`)
    }

    throw new Error('Timed out waiting for transaction confirmation.')
  }

  async function onSendTip() {
    const dataSuffix = (window as any).__ERC8021_DATA_SUFFIX__
    if (!isAddress(RECIPIENT)) {
      toast.error('Tip recipient is invalid')
      return
    }

    const addr = await ensureWalletIdentity()
    if (!addr) return

    let amount: bigint
    try {
      const v = String(tipUsd || '').trim()
      if (!v) throw new Error('Enter an amount')
      amount = parseUnits(v, USDC_DECIMALS)
      if (amount <= 0n) throw new Error('Amount must be > 0')
    } catch (e: any) {
      toast.error(e?.message || 'Invalid amount')
      return
    }

    setTipStage('preparing')
    try {
      await hapticImpact(capabilities, 'medium')
      await new Promise((r) => setTimeout(r, 1200))

      const provider: any = await getEthereumProvider(selectedWalletId, { isInMiniApp, client: miniClient })

      const chainId = (await provider.request({ method: 'eth_chainId' })) as string
      if (chainId !== '0x2105') {
        try {
          await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] })
        } catch {
          throw new Error('Please switch to Base Mainnet (0x2105) to send a tip.')
        }
      }

      const recipient = getAddress(RECIPIENT)
      const data = encodeErc20Transfer(recipient, amount)
      const dataWithSuffix = appendCalldataSuffix(data as `0x${string}`, dataSuffix)

      setTipStage('confirm')

      const callsPayloadWithCaps: any = {
        version: '2.0.0',
        from: addr,
        chainId: '0x2105',
        atomicRequired: true,
        calls: [{ to: USDC_CONTRACT, value: '0x0', data }],
        ...(dataSuffix
          ? { capabilities: { dataSuffix: { value: dataSuffix, optional: true } } }
          : {}),
      }

      const callsPayloadNoCaps: any = {
        version: '2.0.0',
        from: addr,
        chainId: '0x2105',
        atomicRequired: true,
        calls: [{ to: USDC_CONTRACT, value: '0x0', data: dataWithSuffix }],
      }

      try {
        try {
          await provider.request({ method: 'wallet_sendCalls', params: [callsPayloadWithCaps] })
        } catch (e: any) {
          if (isInvalidParamsOrCapability(e)) {
            await provider.request({ method: 'wallet_sendCalls', params: [callsPayloadNoCaps] })
          } else {
            throw e
          }
        }
      } catch (e: any) {
        if (!isMethodNotSupported(e)) throw e

        const balHex = (await provider.request({ method: 'eth_getBalance', params: [addr, 'latest'] })) as string
        if (BigInt(balHex) === 0n) {
          throw new Error('This wallet cannot send batch calls here, and you have 0 Base ETH for gas. Add Base ETH and retry.')
        }

        const tx = { from: addr, to: USDC_CONTRACT, value: '0x0', data: dataWithSuffix }
        await provider.request({ method: 'eth_sendTransaction', params: [tx] })
      }
      setTipStage('sending')
      await new Promise((r) => setTimeout(r, 500))
      setTipStage('done')
    } catch (e: any) {
      if (isUserRejection(e)) {
        toast.message('Tip cancelled')
      } else {
        toast.error(e?.message || 'Tip failed')
      }
      setTipStage('idle')
    }
  }

  function closeTip() {
    setTipOpen(false)
    setTipStage('idle')
  }

  const creditsLabel = credits === null ? '—' : String(credits)
  const creditBusy = submittingCredit || verifyingCredit
  const creditIdleText = walletConnected ? 'Get Credit' : 'Get Credit'
  const creditLoadingText = submittingCredit ? 'Confirm in wallet' : 'Verifying tx'

  if (!miniLoaded) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <div className="mx-auto max-w-2xl px-4 py-10">
          <Card>
            <CardHeader>
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">BasePosting</div>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-6 w-48" />
              <Skeleton className="mt-3 h-24 w-full" />
              <Skeleton className="mt-4 h-10 w-40" />
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="bg-grid min-h-screen">
        <div className="mx-auto max-w-2xl px-4 py-10">
          {view === 'leaderboard' ? (
            <LeaderboardPage
              identity={identity}
              dark={dark}
              onToggleTheme={() => setDark((v) => !v)}
              onClose={() => setView('home')}
            />
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">BasePosting</div>
                    <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs font-semibold text-zinc-700 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-200">
                      {loadingMe ? '…' : `${creditsLabel} credits`}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400"><span>Stay consistent, Stay based, Post banger💙.</span></div>
                </div>

                <div className="flex items-center gap-2">
                  {identity.address ? (
                    <div className="hidden sm:flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs font-semibold text-zinc-700 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-200">
                      <span className="font-mono">{shortAddress(identity.address)}</span>
                    </div>
                  ) : null}

                  <Button
                    variant="ghost"
                    aria-label="Leaderboard"
                    onClick={() => setView('leaderboard')}
                  >
                    <LeaderboardIcon className="h-8 w-8 lb-rainbow" />
                    <span className="hidden sm:inline">Leaderboard</span>
                  </Button>

                  <Button
                    variant="ghost"
                    aria-label="Toggle theme"
                    onClick={() => setDark((v) => !v)}
                  >
                    {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                    <span className="hidden sm:inline">{dark ? 'Light' : 'Dark'}</span>
                  </Button>
                </div>
              </div>

              <Card className="mt-6">
                <CardHeader>
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{walletConnected ? 'Generate Post' : 'Connect wallet first.'}</div>
                  <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">╰┈➤</div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-3">
                    <Button
                      className="w-full"
                      variant="primary"
                      isLoading={false}
                      disabled={!canGenerate || generating}
                      onClick={() => void onGenerate(false)}
                    >
                      <LoadingLabel
                        active={generating}
                        estimateSec={20}
                        idleText="Generate (-1c)"
                        icon={<Sparkles className="h-4 w-4" />}
                      />
                    </Button>

                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button
                        variant="secondary"
                        isLoading={walletConnecting}
                        onClick={() => void onCreateWallet()}
                        disabled={!miniLoaded}
                        className="w-full sm:w-auto"
                      >
                        <Wallet className="h-4 w-4" />
                        {identity.address ? shortAddress(identity.address) : 'Connect Wallet'}
                      </Button>

                      <Button
                        variant="secondary"
                        isLoading={false}
                        onClick={() => void onGetCredit()}
                        disabled={!miniLoaded || !walletConnected || creditBusy}
                        className="w-full sm:w-auto"
                      >
                        <LoadingLabel
                          active={creditBusy}
                          estimateSec={submittingCredit ? 20 : 45}
                          idleText={creditIdleText}
                          icon={<Wallet className="h-4 w-4" />}
                          loadingText={creditLoadingText}
                        />
                      </Button>

                      <Button
                        variant="ghost"
                        isLoading={sharing}
                        onClick={() => void onShareForCredits()}
                        disabled={!shareEligible || !walletConnected}
                        className="w-full sm:w-auto"
                      >
                        <Send className="h-4 w-4" />
                        Share for 6 credit
                      </Button>

                      <Button
                        variant="ghost"
                        onClick={() => setTipOpen(true)}
                        disabled={!miniLoaded}
                        className="w-full sm:w-auto"
                      >
                        <HandCoins className="h-4 w-4" />
                        Tip Me
                      </Button>
                    </div>
                  </div>

                  {!shareEligible && todayUtc ? (
                    <div className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">Share bonus already claimed for UTC {todayUtc}.</div>
                  ) : null}
                </CardContent>
              </Card>

              {/* Basepost card — kept structurally identical to the top card to kill
                  the render flicker we saw in Base app. No conditional-layout
                  branches (all sub-blocks are always rendered, just shown/hidden
                  via a stable min-height wrapper). */}
              <Card className="mt-6">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Basepost</div>
                      <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                        Photo style: <span className="font-semibold text-zinc-900 dark:text-zinc-100">{photoStyleLabel}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 -mt-0.5">
                      <button
                        onClick={() => setPhotoStyleOpen(true)}
                        className="rounded-2xl p-2 text-zinc-700 transition hover:bg-zinc-100 active:scale-[0.98] dark:text-zinc-200 dark:hover:bg-zinc-900"
                        aria-label="Choose photo style"
                        title="Choose photo style"
                      >
                        <Palette className="h-7 w-7 lb-rainbow" />
                      </button>

                      <Button
                        variant={result ? 'success' : 'attention'}
                        isLoading={false}
                        disabled={!result || generating || posting || generatingImage}
                        onClick={() => void onGeneratePhoto()}
                        className="px-5 py-2.5 text-sm"
                      >
                        <LoadingLabel
                          active={generatingImage}
                          estimateSec={35}
                          idleText="Generate Photo (-5c)"
                          icon={<ImageIcon className="h-4 w-4" />}
                        />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {/* Stable result area with fixed min-height so toggling
                      generating/result/empty never changes card size */}
                  <div style={{ minHeight: 120 }}>
                    {generatingImage ? (
                      <div className="mb-3">
                        <Skeleton className="w-full rounded-2xl" style={{ height: 240 }} />
                      </div>
                    ) : imageUrl ? (
                      <div className="mb-3">
                        <img
                          src={imageUrl}
                          alt="Generated"
                          className="w-full rounded-2xl border border-zinc-200 bg-white object-cover dark:border-zinc-800 dark:bg-zinc-950"
                          style={{ aspectRatio: '4 / 3' }}
                          loading="eager"
                          decoding="async"
                          referrerPolicy="no-referrer"
                          onLoad={() => setImageError(false)}
                          onError={() => setImageError(true)}
                        />

                        {imageError ? (
                          <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                            Couldn’t load the generated image.
                            <button
                              className="ml-2 underline underline-offset-2"
                              onClick={() => {
                                setImageError(false)
                                setImageUrl((prev) => {
                                  if (!prev) return prev
                                  if (prev.startsWith('data:')) return prev
                                  return `${prev}${prev.includes('?') ? '&' : '?'}cb=${Date.now()}`
                                })
                              }}
                            >
                              Retry
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {generating ? (
                      <div className="space-y-3">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-11/12" />
                        <Skeleton className="h-4 w-4/5" />
                      </div>
                    ) : result ? (
                      <div className="whitespace-pre-wrap rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
                        {result}
                      </div>
                    ) : (
                      <div className="text-sm text-zinc-600 dark:text-zinc-400">Hit Generate to see your post here ⌯⌲</div>
                    )}
                  </div>

                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <Button
                      variant="primary"
                      isLoading={posting}
                      disabled={!result}
                      onClick={() => void onPostDirectly()}
                      className="w-full sm:w-auto"
                    >
                      <Send className="h-4 w-4" />
                      Post Directly
                    </Button>

                    <Button
                      variant="secondary"
                      disabled={!result}
                      onClick={() => void onCopy()}
                      className="w-full sm:w-auto"
                    >
                      <Copy className="h-4 w-4" />
                      Copy
                    </Button>
                  </div>

                  {/* REMOVED: the "Connect your wallet to keep credits tied to you"
                      yellow warning box. It was the main source of the nicher-card
                      blink — it mounts/unmounts when `identity.address` toggles,
                      and Base app's webview triggers that toggle on every focus /
                      visibility event. The top card already has a "Connect Wallet"
                      button, so this warning box was redundant. */}
                </CardContent>
              </Card>

              {photoStyleOpen ? (
                <div className="fixed inset-0 z-50">
                  <div
                    className="absolute inset-0 bg-black/50"
                    onClick={() => setPhotoStyleOpen(false)}
                  />

                  <div
                    className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-2xl rounded-t-3xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Photo style</div>
                        <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                          Pick a style, or keep default. (Current: <span className="font-semibold">{photoStyleLabel}</span>)
                        </div>
                      </div>
                      <button
                        className="rounded-xl p-2 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
                        onClick={() => setPhotoStyleOpen(false)}
                        aria-label="Close"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2 max-h-[48vh] overflow-auto pr-1">
                      <button
                        onClick={() => {
                          void hapticSelection(capabilities)
                          setAndPersistPhotoStyle(null)
                          setPhotoStyleOpen(false)
                          toast.message('Using default style')
                        }}
                        className={`rounded-2xl border px-3 py-3 text-left transition active:scale-[0.98] ${
                          !photoStylePreset
                            ? 'border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900'
                            : 'border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900'
                        }`}
                      >
                        <div className="text-sm font-semibold">Default</div>
                        <div className="mt-0.5 text-xs opacity-80">Use server env default</div>
                      </button>

                      {PHOTO_STYLE_OPTIONS.map((opt) => (
                        <button
                          key={opt.key}
                          onClick={() => {
                            void hapticSelection(capabilities)
                            setAndPersistPhotoStyle(opt.key)
                            setPhotoStyleOpen(false)
                            toast.message(`Style: ${opt.label}`)
                          }}
                          className={`rounded-2xl border px-3 py-3 text-left transition active:scale-[0.98] ${
                            photoStylePreset === opt.key
                              ? 'border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900'
                              : 'border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900'
                          }`}
                        >
                          <div className="text-sm font-semibold">{opt.label}</div>
                          <div className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">{opt.desc}</div>
                        </button>
                      ))}
                    </div>

                    <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-500">
                      Tip: If you select nothing, the server will use default.
                    </div>
                  </div>
                </div>
              ) : null}

              {tipOpen ? (
                <div className="fixed inset-0 z-50">
                  <div
                    className="absolute inset-0 bg-black/50"
                    onClick={() => closeTip()}
                  />

                  <div
                    className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-2xl rounded-t-3xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Tip with USDC</div>
                        <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Network: Base Mainnet • Token: USDC</div>
                      </div>
                      <button
                        className="rounded-xl p-2 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
                        onClick={() => closeTip()}
                        aria-label="Close"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    {tipStage === 'done' ? (
                      <div className="mt-8 flex flex-col items-center text-center">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-zinc-200 bg-zinc-50 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white">
                          <HandCoins className="h-6 w-6" />
                        </div>
                        <div className="mt-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">Tip sent 💙</div>
                        <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Thank you. You’re making this mini app better.</div>
                        <div className="mt-4 text-xs text-zinc-500 dark:text-zinc-500">Closing…</div>
                      </div>
                    ) : (
                      <>
                        <div className="mt-4 grid grid-cols-4 gap-2">
                          {[100, 250, 500, 1000].map((v) => (
                            <button
                              key={v}
                              onClick={() => setTipUsd(String(v))}
                              className={`rounded-2xl border px-3 py-2 text-sm font-semibold transition active:scale-[0.98] ${
                                String(v) === String(tipUsd)
                                  ? 'border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900'
                                  : 'border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900'
                              }`}
                            >
                              ${v}
                            </button>
                          ))}
                        </div>

                        <div className="mt-3">
                          <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Custom amount (USD)</label>
                          <input
                            value={tipUsd}
                            onChange={(e) => setTipUsd(e.target.value)}
                            inputMode="decimal"
                            placeholder="500"
                            className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600"
                          />
                        </div>

                        <div className="mt-4">
                          <Button
                            variant="primary"
                            className="w-full"
                            isLoading={tipStage === 'preparing' || tipStage === 'confirm' || tipStage === 'sending'}
                            disabled={tipStage !== 'idle'}
                            onClick={() => void onSendTip()}
                          >
                            <HandCoins className="h-4 w-4" />
                            {tipStage === 'idle'
                              ? 'Send USDC'
                              : tipStage === 'preparing'
                                ? 'Preparing tip…'
                                : tipStage === 'confirm'
                                  ? 'Confirm in wallet'
                                  : 'Sending…'}
                          </Button>
                          <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                            Recipient: <span className="font-mono">{shortAddress(RECIPIENT)}</span>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ) : null}
            </>
          )}

          <div className="mt-8 text-center text-xs text-zinc-500 dark:text-zinc-500">
            © Copyright 2026
          </div>
        </div>
      </div>

      {walletModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-4xl overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
            <div className="grid md:grid-cols-[360px_minmax(0,1fr)]">
              <div className="border-b border-zinc-200 p-6 md:border-b-0 md:border-r dark:border-zinc-800">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-2xl font-bold text-zinc-900 dark:text-white">Connect a Wallet</div>
                    <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Click a detected wallet to connect.</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setWalletModalOpen(false)}
                    className="rounded-full p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-white"
                    aria-label="Close wallet modal"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="mt-6 space-y-2">
                  {walletOptions.length ? walletOptions.map((option) => {
                    const active = option.id === selectedWalletId
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => void connectWallet(option)}
                        className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${active ? 'border-zinc-900 bg-zinc-100 dark:border-white dark:bg-zinc-900' : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/70'}`}
                      >
                        <div>
                          <div className="text-base font-semibold text-zinc-900 dark:text-white">{option.name}</div>
                          <div className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">{option.source === 'miniapp' ? 'Detected from current mini app host' : 'Detected from this browser / device'}</div>
                        </div>
                        <div className="rounded-full border border-zinc-200 px-2 py-1 text-[11px] font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">{active ? 'Preferred' : 'Connect'}</div>
                      </button>
                    )
                  }) : (
                    <div className="rounded-2xl border border-dashed border-zinc-300 px-4 py-5 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                      No wallet detected here yet. Open this page in Base app, Trust Wallet, MetaMask, Rabby, OKX, or another wallet-enabled browser.
                    </div>
                  )}
                </div>
              </div>

              <div className="p-6 md:p-8">
                <div className="text-center text-4xl font-bold text-zinc-900 dark:text-white">What is a Wallet?</div>
                <div className="mx-auto mt-10 max-w-md space-y-8">
                  <div className="flex gap-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-200 to-cyan-200 text-zinc-900 dark:from-indigo-500/30 dark:to-cyan-500/30 dark:text-white">
                      <Wallet className="h-7 w-7" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-zinc-900 dark:text-white">A Home for your Digital Assets</div>
                      <div className="mt-1 text-lg leading-7 text-zinc-600 dark:text-zinc-400">Wallets are used to send, receive, store, and display digital assets like Ethereum and NFTs.</div>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-200 to-violet-200 text-zinc-900 dark:from-fuchsia-500/30 dark:to-violet-500/30 dark:text-white">
                      <Sparkles className="h-7 w-7" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-zinc-900 dark:text-white">A New Way to Log In</div>
                      <div className="mt-1 text-lg leading-7 text-zinc-600 dark:text-zinc-400">Instead of creating new accounts and passwords on every website, just connect your wallet.</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {miniLoaded ? <RoadmapBell /> : null}
    </div>
  )
}
