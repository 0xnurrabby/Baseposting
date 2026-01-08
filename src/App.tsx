import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Copy, Moon, Send, Sparkles, Sun, Wallet, HandCoins, X } from 'lucide-react'
import { getAddress, isAddress, parseUnits, encodeFunctionData, keccak256, toHex } from 'viem'

import { Card, CardContent, CardHeader } from '@/components/Card'
import { Button } from '@/components/Button'
import { Skeleton } from '@/components/Skeleton'
import { apiGenerate, apiMe, apiShareAward, apiVerifyTx, type Identity } from '@/lib/api'
import { composeCast, getEthereumProvider, hapticImpact, hapticSelection, initMiniApp } from '@/lib/miniapp'

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

// Public site URL for embeds/shares (defaults to the current host)
const SITE_URL = import.meta.env.VITE_PUBLIC_SITE_URL || window.location.origin

// Tip (USDC) requirements
const USDC_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const USDC_DECIMALS = 6

// Recipient for tips (must be a valid checksummed EVM address).
// Default: the address you requested. Override via VITE_TIP_RECIPIENT if needed.
const RECIPIENT =
  import.meta.env.VITE_TIP_RECIPIENT ||
  '0xe8Bda2Ed9d2FC622D900C8a76dc455A3e79B041f'

function isUserRejection(e: any) {
  const msg = String(e?.message || '').toLowerCase()
  return e?.code === 4001 || msg.includes('user rejected') || msg.includes('rejected') || msg.includes('denied')
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
  // transfer(address,uint256) selector = a9059cbb
  const selector = 'a9059cbb'
  const to = pad32(recipient)
  const val = pad32(amount.toString(16))
  return `0x${selector}${to}${val}`
}

export default function App() {
  const [mounted, setMounted] = useState(false)
  const [dark, setDark] = useState(true)

  const [miniLoaded, setMiniLoaded] = useState(false)
  const [isInMiniApp, setIsInMiniApp] = useState(false)
  const [capabilities, setCapabilities] = useState<string[]>([])

  const [identity, setIdentity] = useState<Identity>({})
  const [credits, setCredits] = useState<number | null>(null)
  const [shareEligible, setShareEligible] = useState<boolean>(false)
  const [todayUtc, setTodayUtc] = useState<string>('')

  const [result, setResult] = useState<string>('')

  const [loadingMe, setLoadingMe] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [posting, setPosting] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [gettingCredit, setGettingCredit] = useState(false)

  // Wallet connect UX
  const autoConnectTriedRef = useRef(false)
  const [, setWalletConnecting] = useState(false)

  // Tip modal state machine
  const [tipOpen, setTipOpen] = useState(false)
  const [tipUsd, setTipUsd] = useState('5')
  const [tipStage, setTipStage] = useState<'idle' | 'preparing' | 'confirm' | 'sending' | 'done'>('idle')

  // Keep the button responsive; we enforce identity + credits inside the handler.
  const canGenerate = useMemo(() => !generating && miniLoaded && isInMiniApp, [generating, miniLoaded, isInMiniApp])

  useEffect(() => {
    setMounted(true)
    const stored = localStorage.getItem('bp_theme')
    setDark(stored ? stored === 'dark' : true)
  }, [])

  useEffect(() => {
    if (!mounted) return
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('bp_theme', dark ? 'dark' : 'light')
  }, [dark, mounted])

  useEffect(() => {
    const boot = async () => {
      try {
        const s = await initMiniApp()
        setIsInMiniApp(s.isInMiniApp)
        setCapabilities(s.capabilities)

        if (s?.user?.fid) {
          setIdentity({ fid: Number(s.user.fid) })
        }
      } finally {
        setMiniLoaded(true)
      }
    }
    void boot()
  }, [])

  // Auto-connect wallet on entry (best effort). If the user rejects once, we don't spam.
  useEffect(() => {
    const auto = async () => {
      if (!miniLoaded || !isInMiniApp) return
      if (identity.address) return
      if (autoConnectTriedRef.current) return

      const blockedUntil = Number(localStorage.getItem('bp_wallet_reject_until') || '0')
      if (blockedUntil && Date.now() < blockedUntil) {
        autoConnectTriedRef.current = true
        return
      }

      autoConnectTriedRef.current = true
      setWalletConnecting(true)
      try {
        const provider: any = await getEthereumProvider()
        // Try silent first.
        const existing = (await provider.request({ method: 'eth_accounts' })) as string[]
        if (existing?.[0]) {
          setIdentity((prev) => ({ ...prev, address: existing[0] }))
          return
        }

        // Then prompt (user requested auto-connect).
        const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[]
        const addr = accounts?.[0]
        if (addr) setIdentity((prev) => ({ ...prev, address: addr }))
      } catch (e: any) {
        if (isUserRejection(e)) {
          // Don't auto-prompt again for 12h
          localStorage.setItem('bp_wallet_reject_until', String(Date.now() + 12 * 60 * 60 * 1000))
        }
      } finally {
        setWalletConnecting(false)
      }
    }
    void auto()
  }, [miniLoaded, isInMiniApp, identity.address])

  useEffect(() => {
    const load = async () => {
      if (!miniLoaded) return
      if (!isInMiniApp) return
      if (!identity.fid && !identity.address) return

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
  }, [identity.fid, identity.address, isInMiniApp, miniLoaded])

  async function ensureWalletIdentity() {
    if (identity.address) return identity.address

    setWalletConnecting(true)
    try {
      await hapticSelection(capabilities)
      const provider: any = await getEthereumProvider()
      const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[]
      const addr = accounts?.[0]
      if (!addr) throw new Error('No wallet account')
      setIdentity((prev) => ({ ...prev, address: addr }))
      return addr
    } catch (e: any) {
      if (isUserRejection(e)) {
        toast.message('Wallet request cancelled')
        return null
      }
      toast.error(e?.message || 'Wallet connection failed')
      return null
    } finally {
      setWalletConnecting(false)
    }
  }

  async function refreshMe() {
    if (!identity.fid && !identity.address) return
    try {
      const me = await apiMe(identity)
      setCredits(me.user.credits)
      setShareEligible(me.share.canClaimToday)
      setTodayUtc(me.share.todayUtc)
    } catch {
      // ignore
    }
  }

  async function onGenerate(isRegen = false) {
    if (!canGenerate) return

    // Identity: prefer FID, otherwise wallet address.
    let id: Identity = identity
    if (!id.fid && !id.address) {
      const addr = await ensureWalletIdentity()
      if (!addr) return
      id = { ...id, address: addr }
    }

    // Ensure credits are loaded.
    let currentCredits = credits ?? 0
    if (credits === null) {
      try {
        setLoadingMe(true)
        const me = await apiMe(id)
        setCredits(me.user.credits)
        currentCredits = me.user.credits
        setShareEligible(me.share.canClaimToday)
        setTodayUtc(me.share.todayUtc)
      } catch (e: any) {
        toast.error(e?.message || 'Failed to load credits')
        return
      } finally {
        setLoadingMe(false)
      }
    }

    if (currentCredits < 1) {
      toast.error('No credits left')
      return
    }

    setGenerating(true)
    setResult('')
    try {
      await hapticImpact(capabilities, 'medium')
      // No user prompt; backend uses its internal prompt strategy.
      const out = await apiGenerate(id, '')
      setResult(out.text)
      setCredits(out.credits)
      toast.success('Cooked ✅')
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
      // Post ONLY the generated text (no app link / no embed)
      const cast = await composeCast({ text: result })
      if (!cast) {
        toast.message('Post cancelled')
        return
      }
      toast.success('Composer opened')
    } catch (e: any) {
      if (isUserRejection(e)) return toast.message('Post cancelled')
      toast.error(e?.message || 'Failed to open composer')
    } finally {
      setPosting(false)
    }
  }


  async function onShareForCredits() {
    setSharing(true)
    try {
      await hapticImpact(capabilities, 'medium')
      const shareText = `I just generated a Base banger with BasePosting. Want to stay consistent on Base?💙 Try it: ${SITE_URL}/` // keep it simple
      const cast = await composeCast({
        text: shareText,
        embeds: [`${SITE_URL}/`],
      })
      if (!cast) {
        toast.message('Share cancelled')
        return
      }

      const award = await apiShareAward(identity)
      setCredits(award.credits)
      setShareEligible(false)
      setTodayUtc(award.todayUtc)
      toast.success(award.alreadyClaimed ? 'Already claimed today' : '+2 credits added')
      await refreshMe()
    } catch (e: any) {
      if (isUserRejection(e)) return toast.message('Share cancelled')
      toast.error(e?.message || 'Share failed')
    } finally {
      setSharing(false)
    }
  }

  async function onGetCredit() {
    setGettingCredit(true)
    try {
      const addr = await ensureWalletIdentity()
      if (!addr) return

      await hapticImpact(capabilities, 'medium')
      const provider: any = await getEthereumProvider()

      // Require Base Mainnet
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

      // Ensure the user has *some* ETH for gas on Base.
      // We intentionally avoid enforcing a fixed minimum (Base fees are usually tiny and fluctuate).
      const balHex = (await provider.request({
        method: 'eth_getBalance',
        params: [addr, 'latest'],
      })) as string

      const balance = BigInt(balHex)
      if (balance === 0n) {
        throw new Error('You need a tiny amount of ETH on Base to pay gas (even for 0 value). Add a little Base ETH and retry.')
      }

      const dataSuffix = (window as any).__ERC8021_DATA_SUFFIX__

      const action = keccak256(toHex('BASEPOSTING_GET_CREDIT'))
      const payload = toHex(
        JSON.stringify({
          fid: identity?.fid ?? null,
          address: addr,
          ts: Date.now(),
          app: 'BasePosting',
        }),
      )

      const data = encodeFunctionData({
        abi: LOG_ACTION_ABI,
        functionName: 'logAction',
        args: [action, payload],
      })

      const request: any = {
        method: 'eth_sendTransaction',
        params: [
          {
            from: addr,
            to: CONTRACT,
            value: '0x0',
            data,
          },
        ],
      }

      // Builder attribution capability (best-effort)
      if (dataSuffix) {
        request.capabilities = { dataSuffix }
      }

      const txHash = (await provider.request(request)) as string
      toast.message('Tx sent. Verifying…')

      // Give the network a moment to index the tx (some RPCs return "tx not found" briefly).
      await new Promise((r) => setTimeout(r, 2500))

      const verified = await apiVerifyTx(identity?.fid ? identity : { address: addr }, txHash)
      setCredits(verified.credits)

      if (verified?.pending) {
        toast.message('Transaction is pending on Base. Please wait a few seconds and tap Get Credit again (or refresh).')
        return
      }

      toast.success('+1 credit added')
    } catch (e: any) {
      if (isUserRejection(e)) {
        toast.message('Transaction cancelled')
      } else {
        toast.error(e?.message || 'Transaction failed')
      }
    } finally {
      setGettingCredit(false)
      await refreshMe()
    }
  }

  async function onSendTip() {
    // Basic guards
    const dataSuffix = (window as any).__ERC8021_DATA_SUFFIX__
    if (!dataSuffix) {
      toast.error('Builder code missing. Set BUILDER_CODE in /public/builder-attribution.js')
      return
    }
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

      // Pre-transaction UX: animate 1–1.5s BEFORE wallet opens.
      await new Promise((r) => setTimeout(r, 1200))

      const provider: any = await getEthereumProvider()

      // Chain handling (strict): Base Mainnet only
      const chainId = (await provider.request({ method: 'eth_chainId' })) as string
      if (chainId !== '0x2105') {
        try {
          await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] })
        } catch (e: any) {
          throw new Error('Please switch to Base Mainnet (0x2105) to send a tip.')
        }
      }

      const recipient = getAddress(RECIPIENT)
      const data = encodeErc20Transfer(recipient, amount)

      setTipStage('confirm')

      const payload = {
        version: '2.0.0',
        from: addr,
        chainId: '0x2105',
        atomicRequired: true,
        calls: [
          {
            to: USDC_CONTRACT,
            value: '0x0',
            data,
          },
        ],
        capabilities: {
          dataSuffix,
        },
      }

      // ERC-5792
      await provider.request({ method: 'wallet_sendCalls', params: [payload] })

      setTipStage('sending')
      await new Promise((r) => setTimeout(r, 500))
      setTipStage('done')
      toast.success('Tip sent ✅')
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

  if (!isInMiniApp) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <div className="mx-auto max-w-2xl px-4 py-10">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">BasePosting</div>
                  <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">This experience is only available inside a Farcaster / Base Mini App.</div>
                </div>
                <div className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-semibold text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">Mini App required</div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-zinc-700 dark:text-zinc-300">
                Open <span className="font-semibold">{SITE_URL}/</span> from inside a Farcaster client (Warpcast / Base app), not a normal browser. If you are actually in the mini app, then refresh the page.
              </div>
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
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <div className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">BasePosting</div>
                <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs font-semibold text-zinc-700 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-200">
                  {loadingMe ? '…' : `${creditsLabel} credits`}
                </span>
              </div>
              <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Stay consistent, Stay based, Post banger💙.</div>
            </div>

            <div className="flex items-center gap-2">
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
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Generate Basepost</div>
              <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">╰┈➤</div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3">
                <Button
                  className="w-full"
                  variant="primary"
                  isLoading={generating}
                  disabled={!canGenerate}
                  onClick={() => void onGenerate(false)}
                >
                  <Sparkles className="h-4 w-4" />
                  {generating ? 'Working…' : 'Generate'}
                </Button>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    variant="secondary"
                    isLoading={gettingCredit}
                    onClick={() => void onGetCredit()}
                    disabled={!miniLoaded}
                    className="w-full sm:w-auto"
                  >
                    <Wallet className="h-4 w-4" />
                    Get Credit
                  </Button>

                  <Button
                    variant="ghost"
                    isLoading={sharing}
                    onClick={() => void onShareForCredits()}
                    disabled={!shareEligible || (!identity.fid && !identity.address)}
                    className="w-full sm:w-auto"
                  >
                    <Send className="h-4 w-4" />
                    Share for 2 credit
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

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <Card className="mt-6">
              <CardHeader>
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Basepost</div>
                <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400"></div>
              </CardHeader>
              <CardContent>
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

                {!identity.fid && !identity.address ? (
                  <div className="mt-4 rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-900 dark:border-yellow-900/40 dark:bg-yellow-950/30 dark:text-yellow-200">
                    Your Farcaster identity wasn’t available. Connect wallet to keep credits tied to you.
                    <div className="mt-2">
                      <Button variant="secondary" onClick={() => void ensureWalletIdentity()}>
                        <Wallet className="h-4 w-4" />
                        Connect Wallet
                      </Button>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </motion.div>

          {tipOpen ? (
            <div className="fixed inset-0 z-50">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/50"
                onClick={() => closeTip()}
              />

              <motion.div
                initial={{ y: 32, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 32, opacity: 0 }}
                transition={{ duration: 0.2 }}
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

                <div className="mt-4 grid grid-cols-4 gap-2">
                  {[1, 5, 10, 25].map((v) => (
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
                    placeholder="5"
                    className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600"
                  />
                </div>

                <div className="mt-4">
                  <Button
                    variant="primary"
                    className="w-full"
                    isLoading={tipStage === 'preparing' || tipStage === 'confirm' || tipStage === 'sending'}
                    disabled={tipStage !== 'idle' && tipStage !== 'done'}
                    onClick={() => void onSendTip()}
                  >
                    <HandCoins className="h-4 w-4" />
                    {tipStage === 'idle'
                      ? 'Send USDC'
                      : tipStage === 'preparing'
                        ? 'Preparing tip…'
                        : tipStage === 'confirm'
                          ? 'Confirm in wallet'
                          : tipStage === 'sending'
                            ? 'Sending…'
                            : 'Send again'}
                  </Button>
                  <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                    Recipient: <span className="font-mono">{shortAddress(RECIPIENT)}</span>
                  </div>
                </div>
              </motion.div>
            </div>
          ) : null}

          <div className="mt-8 text-center text-xs text-zinc-500 dark:text-zinc-500">
            © Copyright 2026
          </div>
        </div>
      </div>
    </div>
  )
}
