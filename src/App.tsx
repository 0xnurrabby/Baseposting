import React, { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Copy, Moon, Send, Sparkles, Sun, Wallet, HandCoins, X, Image as ImageIcon } from 'lucide-react'
import { getAddress, isAddress, parseUnits, encodeFunctionData, keccak256, toHex } from 'viem'

import { Card, CardContent, CardHeader } from '@/components/Card'
import { Button } from '@/components/Button'
import { Skeleton } from '@/components/Skeleton'
import { RoadmapBell } from '@/components/RoadmapBell'
import { LeaderboardPage } from '@/components/LeaderboardPage'
import { LeaderboardIcon } from '@/components/LeaderboardIcon'
import { apiGenerate, apiMe, apiShareAward, apiVerifyTx, type Identity } from '@/lib/api'
import { connectWalletProvider, getEthereumProvider, hapticImpact, hapticSelection, initMiniApp, listAvailableWallets, shareToTwitter, type WalletOption } from '@/lib/miniapp'

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
  'Okay this is actually useful 💙 Now I just open BasePosting — one tap gives banger post ideas in seconds. Try it: {url}',
  'Creators on Base: this is your cheat code ⚡️ BasePosting gives post ideas in seconds. Try it: {url}',
  'Posting on Base got 10x easier. Open BasePosting → pick an idea → post ✅ {url}',
  'Stop overthinking your next Base post 😮‍💨 BasePosting spits out viral post ideas instantly. {url}',
  'Found a tool that makes posting on Base effortless 🧠✨ BasePosting = ideas in seconds. {url}',
  'Hot tip: if you’re stuck on what to post on Base, use BasePosting 💙 {url}',
  'Need a Base post right now? BasePosting → one tap → done 🚀 {url}',
  'BasePosting is kinda unfair 😅 Banger post ideas for Base in seconds. {url}',
  'If you post on Base, you want this. BasePosting gives banger ideas in seconds 🔥 {url}',
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

function getRotatingShareCopy(siteUrl: string): { text: string; url: string } {
  const url = normalizeSiteUrl(siteUrl)
  if (!url) return { text: '', url: '' }

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

  // Return text WITHOUT the URL; shareToTwitter will add the URL separately.
  const raw = SHARE_COPY_TEMPLATES[idx] ?? 'Try it: {url}'
  const text = raw.replace(' {url}', '').replace('{url}', '').trim()
  return { text, url }
}

const USDC_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const USDC_DECIMALS = 6
const RECIPIENT =
  import.meta.env.VITE_TIP_RECIPIENT ||
  '0xe8Bda2Ed9d2FC622D900C8a76dc455A3e79B041f'

function isUserRejection(e: any) {
  const msg = String(e?.message || '').toLowerCase()
  return e?.code === 4001 || msg.includes('user rejected') || msg.includes('rejected') || msg.includes('denied')
}

function isMethodNotSupported(e: any) {
  const msg = String(e?.message || '').toLowerCase()
  return (
    e?.code === -32601 ||
    e?.code === -32004 ||
    msg.includes('method not found') ||
    msg.includes('does not exist') ||
    msg.includes('is not available') ||
    msg.includes('does not support the requested method') ||
    msg.includes('unsupported method') ||
    msg.includes('not supported') ||
    msg.includes('unsupported')
  )
}

function isInvalidParamsOrCapability(e: any) {
  const msg = String(e?.message || '').toLowerCase()
  return (
    e?.code === -32602 ||
    msg.includes('invalid params') ||
    msg.includes('invalid request') ||
    msg.includes('capabilities') ||
    msg.includes('datasuffix') ||
    msg.includes('unknown field') ||
    msg.includes('unexpected') ||
    msg.includes('unsupported capability')
  )
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

  const [loadingMe, setLoadingMe] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [posting, setPosting] = useState(false)
  const [sharing, setSharing] = useState(false)

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

  const identityRef = useRef<Identity>(identity)
  identityRef.current = identity
  const creditsRef = useRef<number | null>(credits)
  creditsRef.current = credits
  const resultRef = useRef<string>(result)
  resultRef.current = result
  const capabilitiesRef = useRef<string[]>(capabilities)
  capabilitiesRef.current = capabilities
  const miniClientRef = useRef<any>(miniClient)
  miniClientRef.current = miniClient
  const isInMiniAppRef = useRef<boolean>(isInMiniApp)
  isInMiniAppRef.current = isInMiniApp
  const selectedWalletIdRef = useRef<string>(selectedWalletId)
  selectedWalletIdRef.current = selectedWalletId

  const PENDING_TOAST_KEY = 'bp_pending_toast_v1'
  const PENDING_SHARE_AWARD_KEY = 'bp_pending_share_award_v1'

  function setPendingToast(kind: 'success' | 'message' | 'error', text: string) {
    try {
      sessionStorage.setItem(PENDING_TOAST_KEY, JSON.stringify({ kind, text, ts: Date.now() }))
    } catch {
      // ignore
    }
  }

  const walletConnected = Boolean(identity.address)
  const canGenerate = !generating && miniLoaded && walletConnected

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

      const id = identityRef.current
      if (miniLoaded && id.address) {
        void (async () => {
          let handledShareAward = false
          try {
            const pending = sessionStorage.getItem(PENDING_SHARE_AWARD_KEY)
            if (pending && !shareAwardInFlight.current) {
              sessionStorage.removeItem(PENDING_SHARE_AWARD_KEY)
              shareAwardInFlight.current = true
              handledShareAward = true
              setCredits((prev) => Math.max(0, (prev ?? 0) + 6))
              const award = await apiShareAward(id)
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
              const me = await apiMe(id)
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
  }, [miniLoaded])

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

        if (attempts >= maxVisibleAttempts) return

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

  const openWalletPicker = useCallback(async () => {
    setWalletConnecting(true)
    try {
      const found = await listAvailableWallets({
        isInMiniApp: isInMiniAppRef.current,
        client: miniClientRef.current,
      })
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
        toast.error('No wallet found. Open this app in Base, Trust, MetaMask, Rabby, OKX, Bitget, or another wallet-enabled browser.')
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to detect wallets')
    } finally {
      setWalletConnecting(false)
    }
  }, [])

  const onCreateWallet = useCallback(async () => {
    await openWalletPicker()
  }, [openWalletPicker])

  const ensureWalletIdentity = useCallback(async () => {
    if (identityRef.current.address) return identityRef.current.address
    await openWalletPicker()
    return null
  }, [openWalletPicker])

  const connectWallet = useCallback(async (option: WalletOption) => {
    setWalletConnecting(true)
    try {
      await hapticSelection(capabilitiesRef.current)
      const { address: addr } = await connectWalletProvider(option, {
        isInMiniApp: isInMiniAppRef.current,
        client: miniClientRef.current,
      })
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
  }, [])

  const refreshMe = useCallback(async () => {
    const id = identityRef.current
    if (!id.address) return
    try {
      const me = await apiMe(id)
      setCredits(me.user.credits)
      setShareEligible(me.share.canClaimToday)
      setTodayUtc(me.share.todayUtc)
    } catch {
      // ignore
    }
  }, [])

  const onGenerate = useCallback(async () => {
    if (generating || !miniLoaded) return

    let id = identityRef.current
    if (!id.address) {
      const addr = await ensureWalletIdentity()
      if (!addr) return
      id = { address: addr }
    }

    const currentCredits = creditsRef.current ?? 3
    if (currentCredits < 3) {
      toast.error('Need 3 credits to generate')
      return
    }

    setGenerating(true)
    setResult('')
    try {
      await hapticImpact(capabilitiesRef.current, 'medium')
      const out = await apiGenerate(id, '')
      setResult(out.text)
      setCredits(out.credits)
      toast.success('Cooked :)')
    } catch (e: any) {
      const status = (e as any)?.status
      if (status === 402) {
        setCredits((e as any)?.data?.credits ?? 0)
        toast.error('Not enough credits (need 3)')
      } else {
        toast.error(e?.message || 'Generation failed')
      }
    } finally {
      setGenerating(false)
    }
  }, [generating, miniLoaded, ensureWalletIdentity])

  const onCopy = useCallback(async () => {
    const current = resultRef.current
    if (!current) return
    try {
      await hapticSelection(capabilitiesRef.current)
      await copyText(current)
      toast.success('Copied')
    } catch {
      toast.error('Copy failed')
    }
  }, [])

  const onPostDirectly = useCallback(async () => {
    const current = resultRef.current
    if (!current) return
    setPosting(true)
    try {
      await hapticImpact(capabilitiesRef.current, 'light')
      shareToTwitter({ text: current })
    } catch (e: any) {
      toast.error(e?.message || 'Failed to open X composer')
    } finally {
      setTimeout(() => setPosting(false), 500)
    }
  }, [])

  // Share for 6 credit: now uses Twitter (same as Post to X).
  // Award happens when user returns to the app (visibilitychange effect).
  const onShareForCredits = useCallback(async () => {
    if (!shareEligible) {
      toast.message('Share bonus already claimed today')
      return
    }
    setSharing(true)
    try {
      await hapticImpact(capabilitiesRef.current, 'medium')
      const { text, url } = getRotatingShareCopy(SITE_URL)
      setPendingToast('message', 'Welcome back ✅ Adding your share bonus…')
      try {
        sessionStorage.setItem(PENDING_SHARE_AWARD_KEY, '1')
      } catch {
        // ignore
      }

      shareToTwitter({ text, url })

      // Best-effort fallback: if the user stays on this tab (desktop popup
      // case), award after 3s anyway.
      setTimeout(() => {
        try {
          if (document.visibilityState !== 'visible') return
          const pending = sessionStorage.getItem(PENDING_SHARE_AWARD_KEY)
          if (!pending) return
          sessionStorage.removeItem(PENDING_SHARE_AWARD_KEY)
          void (async () => {
            try {
              setCredits((prev) => Math.max(0, (prev ?? 0) + 6))
              const award = await apiShareAward(identityRef.current)
              setCredits(award.credits)
              setShareEligible(false)
              setTodayUtc(award.todayUtc)
              toast.success(award.alreadyClaimed ? 'Already claimed today' : '+6 credits added 💙')
            } catch {
              // ignore
            }
          })()
        } catch {
          // ignore
        }
      }, 3000)
    } catch (e: any) {
      if (isUserRejection(e)) return toast.message('Share cancelled')
      toast.error(e?.message || 'Share failed')
    } finally {
      setTimeout(() => setSharing(false), 500)
    }
  }, [shareEligible])

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

  const onGetCredit = useCallback(async () => {
    if (submittingCredit || verifyingCredit) return

    setSubmittingCredit(true)
    try {
      const addr = await ensureWalletIdentity()
      if (!addr) {
        setSubmittingCredit(false)
        return
      }

      await hapticImpact(capabilitiesRef.current, 'medium')
      const provider: any = await getEthereumProvider(selectedWalletIdRef.current, {
        isInMiniApp: isInMiniAppRef.current,
        client: miniClientRef.current,
      })

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

      const action = keccak256(toHex('BASEPOSTING_GET_CREDIT'))
      const payload = toHex(
        JSON.stringify({ address: addr, ts: Date.now(), app: 'BasePosting' })
      )

      const data = encodeFunctionData({
        abi: LOG_ACTION_ABI,
        functionName: 'logAction',
        args: [action, payload],
      })

      let txHash = ''
      let usedFallback = false

      const sendLegacyTx = async () => {
        const balHex = (await provider.request({ method: 'eth_getBalance', params: [addr, 'latest'] })) as string
        if (BigInt(balHex) === 0n) {
          throw new Error(
            'Your wallet has 0 Base ETH to pay gas. Please add a small amount of ETH on Base (use bridge.base.org) and retry.'
          )
        }
        const tx: any = {
          from: addr,
          to: CONTRACT,
          data,
        }
        return (await provider.request({ method: 'eth_sendTransaction', params: [tx] })) as string
      }

      try {
        const callsPayload: any = {
          version: '2.0.0',
          from: addr,
          chainId: '0x2105',
          atomicRequired: false,
          calls: [{ to: CONTRACT, data }],
        }
        const sendRes: any = await provider.request({ method: 'wallet_sendCalls', params: [callsPayload] })

        const confirmationId =
          typeof sendRes === 'string'
            ? sendRes
            : sendRes?.callsId || sendRes?.batchId || sendRes?.id || sendRes?.result || sendRes?.hash

        if (!confirmationId || typeof confirmationId !== 'string') {
          throw new Error('wallet_sendCalls returned no id')
        }

        toast.message('Transaction submitted. Verifying on-chain…')
        txHash = /^0x[a-fA-F0-9]{64}$/.test(confirmationId)
          ? confirmationId
          : await waitForCallsTxHash(provider, confirmationId, { timeoutMs: 20000, pollMs: 1200 })
      } catch (e: any) {
        if (isUserRejection(e)) throw e
        if (isMethodNotSupported(e) || isInvalidParamsOrCapability(e)) {
          usedFallback = true
        } else {
          usedFallback = true
        }
      }

      if (!txHash && usedFallback) {
        txHash = await sendLegacyTx()
        toast.message('Transaction submitted. Verifying on-chain…')
      }

      if (!txHash) {
        throw new Error('Could not submit transaction. Please try again.')
      }

      savePendingTx(txHash, addr)
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
  }, [submittingCredit, verifyingCredit, ensureWalletIdentity])

  const onSendTip = useCallback(async () => {
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
      await hapticImpact(capabilitiesRef.current, 'medium')
      await new Promise((r) => setTimeout(r, 1200))

      const provider: any = await getEthereumProvider(selectedWalletIdRef.current, {
        isInMiniApp: isInMiniAppRef.current,
        client: miniClientRef.current,
      })

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

      setTipStage('confirm')

      let submitted = false
      try {
        await provider.request({
          method: 'wallet_sendCalls',
          params: [{
            version: '2.0.0',
            from: addr,
            chainId: '0x2105',
            atomicRequired: false,
            calls: [{ to: USDC_CONTRACT, data }],
          }],
        })
        submitted = true
      } catch (e: any) {
        if (isUserRejection(e)) throw e
        // proceed to legacy path
      }

      if (!submitted) {
        const tx = { from: addr, to: USDC_CONTRACT, data }
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
  }, [tipUsd, ensureWalletIdentity])

  const closeTip = useCallback(() => {
    setTipOpen(false)
    setTipStage('idle')
  }, [])

  const openLeaderboard = useCallback(() => setView('leaderboard'), [])
  const goHome = useCallback(() => setView('home'), [])
  const toggleTheme = useCallback(() => setDark((v) => !v), [])
  const openTipModal = useCallback(() => setTipOpen(true), [])

  const creditsLabel = credits === null ? '—' : String(credits)
  const creditBusy = submittingCredit || verifyingCredit
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
              onToggleTheme={toggleTheme}
              onClose={goHome}
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

                  <Button variant="ghost" aria-label="Leaderboard" onClick={openLeaderboard}>
                    <LeaderboardIcon className="h-8 w-8 lb-rainbow" />
                    <span className="hidden sm:inline">Leaderboard</span>
                  </Button>

                  <Button variant="ghost" aria-label="Toggle theme" onClick={toggleTheme}>
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
                      onClick={onGenerate}
                    >
                    <LoadingLabel
  active={generating}
  estimateSec={20}
  idleText="Generate (-3c)"
  icon={<Sparkles className="h-4 w-4" />}
/>

                    </Button>

                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button
                        variant="secondary"
                        isLoading={walletConnecting}
                        onClick={onCreateWallet}
                        disabled={!miniLoaded}
                        className="w-full sm:w-auto"
                      >
                        <Wallet className="h-4 w-4" />
                        {identity.address ? shortAddress(identity.address) : 'Connect Wallet'}
                      </Button>

                      <Button
                        variant="secondary"
                        isLoading={false}
                        onClick={onGetCredit}
                        disabled={!miniLoaded || !walletConnected || creditBusy}
                        className="w-full sm:w-auto"
                      >
                        <LoadingLabel
                          active={creditBusy}
                          estimateSec={submittingCredit ? 20 : 45}
                          idleText="Get Credit"
                          icon={<Wallet className="h-4 w-4" />}
                          loadingText={creditLoadingText}
                        />
                      </Button>

                      <Button
                        variant="ghost"
                        isLoading={sharing}
                        onClick={onShareForCredits}
                        disabled={!shareEligible || !walletConnected}
                        className="w-full sm:w-auto"
                      >
                        <Send className="h-4 w-4" />
                        Share for 6 credit
                      </Button>

                      <Button
                        variant="ghost"
                        onClick={openTipModal}
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

              <Card className="mt-6">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Basepost</div>
                      <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                        Share your generated post directly to X.
                      </div>
                    </div>

                    <Button
                      variant="secondary"
                      isLoading={false}
                      disabled
                      className="px-5 py-2.5 text-sm opacity-70"
                      title="Photo generation is temporarily disabled"
                    >
                      <ImageIcon className="h-4 w-4" />
                      Photo: off
                    </Button>
                  </div>

                  <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2 text-[11px] font-medium text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                    📸 Photo generation is temporarily disabled (cost saving). It will be back on soon.
                  </div>
                </CardHeader>
                <CardContent>
                  <div style={{ minHeight: 120 }}>
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
                      onClick={onPostDirectly}
                      className="w-full sm:w-auto"
                    >
                      <Send className="h-4 w-4" />
                      Post to X
                    </Button>

                    <Button
                      variant="secondary"
                      disabled={!result}
                      onClick={onCopy}
                      className="w-full sm:w-auto"
                    >
                      <Copy className="h-4 w-4" />
                      Copy
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {tipOpen ? (
                <div className="fixed inset-0 z-50">
                  <div
                    className="absolute inset-0 bg-black/50"
                    onClick={closeTip}
                  />

                  <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-2xl rounded-t-3xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Tip with USDC</div>
                        <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Network: Base Mainnet • Token: USDC</div>
                      </div>
                      <button
                        className="rounded-xl p-2 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
                        onClick={closeTip}
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
                            onClick={onSendTip}
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
                      No wallet detected here yet. Open this page in Base app, Trust Wallet, Bitget Wallet, MetaMask, Rabby, OKX, or another wallet-enabled browser.
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
