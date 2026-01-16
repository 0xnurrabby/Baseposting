import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Copy, Moon, Send, Sparkles, Sun, Wallet, HandCoins, X, Image as ImageIcon } from 'lucide-react'
import { getAddress, isAddress, parseUnits, encodeFunctionData, keccak256, toHex } from 'viem'

import { Card, CardContent, CardHeader } from '@/components/Card'
import { Button } from '@/components/Button'
import { Skeleton } from '@/components/Skeleton'
import { RoadmapBell } from '@/components/RoadmapBell'
import { apiGenerate, apiGenerateImage, apiMe, apiShareAward, apiVerifyTx, type Identity } from '@/lib/api'
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

function isMethodNotSupported(e: any) {
  // JSON-RPC "Method not found" is commonly -32601 across providers.
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
  // Some wallets support wallet_sendCalls but reject unknown fields/capabilities (e.g. dataSuffix)
  const msg = String(e?.message || '').toLowerCase()
  return (
    e?.code === -32602 || // invalid params
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
  // Must be whole bytes
  if (((suffix.length - 2) % 2) !== 0) return data
  if (suffix === '0x') return data
  if (data === '0x') return suffix
  return (data + suffix.slice(2)) as `0x${string}`
}


function isHexBytes(v: any) {
  return typeof v === 'string' && v.startsWith('0x') && v.length % 2 === 0
}

// ERC-8021 attribution is "data suffix bytes appended to calldata".
// For Base Builder Code analytics, AA wallets must apply the ERC-8021 suffix via the
// `capabilities.dataSuffix` field (so it lands on the UserOp callData). We still keep a
// fallback that appends the suffix directly when a wallet rejects capabilities.
function appendErc8021Suffix(calldata: string, suffix?: string) {
  if (!isHexBytes(calldata) || !isHexBytes(suffix)) return calldata
  // Avoid accidental double-append
  if (calldata.toLowerCase().endsWith(suffix.slice(2).toLowerCase())) return calldata
  return (calldata + suffix.slice(2)) as `0x${string}`
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
  const [imageUrl, setImageUrl] = useState<string>('')
  const [imageId, setImageId] = useState<string>('')
  const [imageError, setImageError] = useState(false)
  const [generatingImage, setGeneratingImage] = useState(false)

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

  // Used to show a toast AFTER returning from the Farcaster composer, so the user
  // gets a nice "done" feeling instead of a stuck spinner.
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
      return new URL(raw, SITE_URL).toString()
    } catch {
      return raw
    }
  }

  // Keep the button responsive; we enforce identity + credits inside the handler.
  const canGenerate = useMemo(() => !generating && miniLoaded && isInMiniApp, [generating, miniLoaded, isInMiniApp])

  useEffect(() => {
    setMounted(true)
    const stored = localStorage.getItem('bp_theme')
    setDark(stored ? stored === 'dark' : true)
  }, [])

  // When the user comes back from the Farcaster composer, some hosts don't
  // resolve composeCast() promises. This effect ensures we:
  // 1) clear stuck loading states
  // 2) refresh credits
  // 3) show a pending toast ("+2 credits", "Done", etc.)
  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState !== 'visible') return

      // Safety: never let the UI stay stuck.
      setSharing(false)
      setPosting(false)

      // Refresh credits best-effort (only when we have an identity).
      if (miniLoaded && isInMiniApp && (identity.fid || identity.address)) {
        void (async () => {
          try {
            const me = await apiMe(identity)
            setCredits(me.user.credits)
            setShareEligible(me.share.canClaimToday)
            setTodayUtc(me.share.todayUtc)
          } catch {
            // ignore
          }
        })()

        // If the user just shared, award credits on return (best-effort).
        try {
          const pending = sessionStorage.getItem(PENDING_SHARE_AWARD_KEY)
          if (pending) {
            sessionStorage.removeItem(PENDING_SHARE_AWARD_KEY)
            void (async () => {
              try {
                const award = await apiShareAward(identity)
                setCredits(award.credits)
                setShareEligible(false)
                setTodayUtc(award.todayUtc)
                toast.success(award.alreadyClaimed ? 'Already claimed today' : '+2 credits added 💙')
              } catch {
                // ignore
              }
            })()
          }
        } catch {
          // ignore
        }
      }

      // Show deferred toast.
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
  }, [identity.fid, identity.address, isInMiniApp, miniLoaded])
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
    }).catch(() => {})
  }

  // clean URL so it doesn't stay in address bar
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

  // Auto-close the tip modal after success with a nicer appreciation message.
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
    setImageUrl('')
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

  async function onGeneratePhoto() {
    if (!result) {
      toast.message('Generate a Basepost first')
      return
    }

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
      const out = await apiGenerateImage(id, result)
      // Mini App hosts/proxies can make server-derived absolute URLs unreliable.
      // Always build the preview URL from *this* app's origin.
      const path = out.imageUrl || (out.imageId ? `/api/image?id=${encodeURIComponent(out.imageId)}` : '')
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
      // Post the generated text, and include the generated image (if any).
      // Some hosts never resolve composeCast; fire-and-forget and show toast on return.
      setPendingToast('success', 'Welcome back ✅')
      // Prefer a public absolute URL (e.g., Vercel Blob). If we only have an internal imageId,
      // fall back to our own API route.
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
      const shareText = `I just generated a Base banger with BasePosting. Want to stay consistent on Base?💙 Try it: ${SITE_URL}/` // keep it simple
      // Open composer without blocking UI (some hosts never resolve composeCast).
      // We award the +2 credits AFTER the user returns, to create a proper
      // "done" moment in the mini app.
      setPendingToast('message', 'Welcome back ✅ Adding your share bonus…')
      try {
        sessionStorage.setItem(PENDING_SHARE_AWARD_KEY, '1')
      } catch {
        // ignore
      }
	      void composeCast({ text: shareText, embeds: [`${SITE_URL}/`] })

	      // Fallback: in some clients, the composer opens without triggering
	      // a visibility change. Award after a short delay if we're still visible.
	      const awardIfPending = async () => {
	        try {
	          const award = await apiShareAward(identity)
	          setCredits(award.credits)
	          setShareEligible(false)
	          setTodayUtc(award.todayUtc)
	          toast.success(award.alreadyClaimed ? 'Already claimed today' : '+2 credits added 💙')
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
	      }, 1600)
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

      const dataWithSuffix = appendCalldataSuffix(data as `0x${string}`, dataSuffix)

      // Prefer EIP-5792 with the ERC-8021 dataSuffix capability so AA wallets (Base App / Smart Wallet)
      // can append the attribution suffix to the *UserOp callData* (required for Base onchain analytics).
      const callsPayloadWithCaps: any = {
        version: '2.0.0',
        from: addr,
        chainId: '0x2105',
        atomicRequired: true,
        calls: [
          {
            to: CONTRACT,
            value: '0x0',
            data, // IMPORTANT: do not append suffix here; wallets apply it via capabilities
          },
        ],
        ...(dataSuffix
          ? {
              capabilities: {
                dataSuffix: { value: dataSuffix, optional: true },
              },
            }
          : {}),
      }

      const callsPayloadNoCaps: any = {
        version: '2.0.0',
        from: addr,
        chainId: '0x2105',
        atomicRequired: true,
        calls: [
          {
            to: CONTRACT,
            value: '0x0',
            data: dataWithSuffix, // fallback when wallet rejects capabilities
          },
        ],
      }
      let txHash: string

      // Try EIP-5792 first. If unsupported, fall back to eth_sendTransaction.
      try {
        let sendRes: any
        try {
          sendRes = await provider.request({ method: 'wallet_sendCalls', params: [callsPayloadWithCaps] })
        } catch (e: any) {
          // Some wallets implement wallet_sendCalls but reject the capabilities field.
          // Retry without capabilities while preserving the (less ideal) suffix-on-call-data behavior.
          if (isInvalidParamsOrCapability(e)) {
            sendRes = await provider.request({ method: 'wallet_sendCalls', params: [callsPayloadNoCaps] })
          } else {
            throw e
          }
        }

        const callsId: string =
          typeof sendRes === 'string'
            ? sendRes
            : sendRes?.callsId || sendRes?.batchId || sendRes?.id || sendRes?.result || sendRes?.hash

        if (!callsId || typeof callsId !== 'string') {
          throw new Error('wallet_sendCalls did not return a callsId/batchId.')
        }

        // Wait for wallet_getCallsStatus to yield a transaction hash.
        txHash = await waitForCallsTxHash(provider, callsId)
        toast.message('Batch confirmed. Verifying…')
      } catch (e: any) {
        if (!isMethodNotSupported(e)) throw e

        // Fallback path requires Base ETH for gas.
        const balHex = (await provider.request({ method: 'eth_getBalance', params: [addr, 'latest'] })) as string
        if (BigInt(balHex) === 0n) {
          throw new Error(
            'Your wallet provider in this host does not support wallet_sendCalls, and your account has 0 Base ETH for gas. Add a little ETH on Base and retry.',
          )
        }

        const tx = { from: addr, to: CONTRACT, value: '0x0', data: dataWithSuffix }
        txHash = (await provider.request({ method: 'eth_sendTransaction', params: [tx] })) as string
        toast.message('Tx sent. Verifying…')
      }

      // Give the network a moment to index the tx (some RPCs return "tx not found" briefly).
      await new Promise((r) => setTimeout(r, 1500))

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


async function waitForCallsTxHash(
  provider: any,
  callsId: string,
  opts: { timeoutMs?: number; pollMs?: number } = {},
) {
  const timeoutMs = opts.timeoutMs ?? 120_000
  const pollMs = opts.pollMs ?? 2000
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    let status: any
    try {
      status = await provider.request({ method: 'wallet_getCallsStatus', params: [callsId] })
    } catch (e: any) {
      // 4100 is the EIP-1193 "unsupported method" code used by many wallets.
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

    // 4xx/5xx/6xx are failures per Base docs / EIP-5792
    throw new Error(`Batch failed (status ${isNaN(code) ? String(status?.status) : code}).`)
  }

  throw new Error('Timed out waiting for transaction confirmation.')
}

  async function onSendTip() {
    // Basic guards
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
      const dataWithSuffix = appendCalldataSuffix(data as `0x${string}`, dataSuffix)

      setTipStage('confirm')

      const callsPayloadWithCaps: any = {
        version: '2.0.0',
        from: addr,
        chainId: '0x2105',
        atomicRequired: true,
        calls: [
          {
            to: USDC_CONTRACT,
            value: '0x0',
            data, // IMPORTANT: keep call data clean; wallet applies attribution via capabilities
          },
        ],
        ...(dataSuffix
          ? {
              capabilities: {
                dataSuffix: { value: dataSuffix, optional: true },
              },
            }
          : {}),
      }

      const callsPayloadNoCaps: any = {
        version: '2.0.0',
        from: addr,
        chainId: '0x2105',
        atomicRequired: true,
        calls: [
          {
            to: USDC_CONTRACT,
            value: '0x0',
            data: dataWithSuffix, // fallback when wallet rejects capabilities
          },
        ],
      }

      // Try EIP-5792 first (best UX, can enable smart-account flows). If not supported,
      // fall back to eth_sendTransaction.
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

        // Fallback path requires Base ETH for gas.
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
      // We'll auto-close the modal with a nice message.
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
                  {generating ? 'Working…' : 'Generate (-1c)'}
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
              {/* Extra bottom padding so the CTA doesn't feel stuck to the content below */}
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Basepost</div>
                    <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400"></div>
                  </div>

                  <motion.div
                    className="shrink-0 -mt-0.5"
                    animate={
                      result
                        ? { scale: [1, 1.06, 1], y: [0, -1, 0] }
                        : { scale: 1, y: 0 }
                    }
                    transition={
                      result
                        ? { duration: 0.9, repeat: Infinity, repeatDelay: 1.2, ease: 'easeInOut' }
                        : { duration: 0 }
                    }
                  >
                    <Button
                      variant={result ? 'success' : 'attention'}
                      isLoading={generatingImage}
                      disabled={!result || generating || posting}
                      onClick={() => void onGeneratePhoto()}
                      className="px-5 py-2.5 text-sm"
                    >
                      <ImageIcon className="h-4 w-4" />
                      Generate Photo (-5c)
                    </Button>
                  </motion.div>
                </div>
              </CardHeader>
              <CardContent>
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
                      loading="lazy"
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
                            setImageUrl((prev) =>
                              prev
                                ? `${prev}${prev.includes('?') ? '&' : '?'}cb=${Date.now()}`
                                : prev
                            )
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

	                {tipStage === 'done' ? (
	                  <motion.div
	                    initial={{ opacity: 0, y: 10 }}
	                    animate={{ opacity: 1, y: 0 }}
	                    transition={{ duration: 0.25 }}
	                    className="mt-8 flex flex-col items-center text-center"
	                  >
	                    <motion.div
	                      initial={{ scale: 0.85 }}
	                      animate={{ scale: 1 }}
	                      transition={{ type: 'spring', stiffness: 260, damping: 16 }}
	                      className="flex h-14 w-14 items-center justify-center rounded-full border border-zinc-200 bg-zinc-50 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
	                    >
	                      <HandCoins className="h-6 w-6" />
	                    </motion.div>
	                    <div className="mt-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">Tip sent 💙</div>
	                    <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Thank you. You’re making this mini app better.</div>
	                    <div className="mt-4 text-xs text-zinc-500 dark:text-zinc-500">Closing…</div>
	                  </motion.div>
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
              </motion.div>
            </div>
          ) : null}

          <div className="mt-8 text-center text-xs text-zinc-500 dark:text-zinc-500">
            © Copyright 2026
          </div>
        </div>
      </div>

      {/* Floating notifications / roadmap */}
      <RoadmapBell />
    </div>
  )
}
