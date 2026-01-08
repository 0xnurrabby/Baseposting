import React, { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Copy, Moon, Send, Sparkles, Sun, Wallet } from 'lucide-react'

import { Card, CardContent, CardHeader } from '@/components/Card'
import { Button } from '@/components/Button'
import { Skeleton } from '@/components/Skeleton'
import { apiGenerate, apiMe, apiShareAward, apiVerifyTx, type Identity } from '@/lib/api'
import { composeCast, getEthereumProvider, hapticImpact, hapticSelection, initMiniApp } from '@/lib/miniapp'

const CONTRACT = '0xB331328F506f2D35125e367A190e914B1b6830cF'

function isUserRejection(e: any) {
  const msg = String(e?.message || '').toLowerCase()
  return e?.code === 4001 || msg.includes('user rejected') || msg.includes('rejected') || msg.includes('denied')
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text)
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

  // Allow the button to be clickable; we will enforce credits inside onGenerate.
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

  async function ensureCreditsLoaded(id: Identity) {
    // Fetch credits on-demand (so the app still works even if FID isn't available at mount).
    try {
      setLoadingMe(true)
      const me = await apiMe(id)
      setCredits(me.user.credits)
      setShareEligible(me.share.canClaimToday)
      setTodayUtc(me.share.todayUtc)
      return me.user.credits
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load credits')
      return null
    } finally {
      setLoadingMe(false)
    }
  }

  async function onGenerate(isRegen = false) {
    if (!canGenerate) return

    // Ensure we have an identity (prefer FID; fallback to wallet address).
    let id: Identity = { ...identity }
    if (!id.fid && !id.address) {
      const addr = await ensureWalletIdentity()
      if (!addr) return
      id = { address: addr }
    }

    // Ensure credits are loaded before spending.
    let currentCredits = credits
    if (currentCredits === null) {
      const loaded = await ensureCreditsLoaded(id)
      if (loaded === null) return
      currentCredits = loaded
    }

    if ((currentCredits ?? 0) < 1) {
      toast.error('No credits left')
      return
    }

    setGenerating(true)
    setResult('')
    try {
      await hapticImpact(capabilities, 'medium')
      // No user prompt input — generation uses the app's internal prompt strategy.
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
      const cast = await composeCast({
        text: result,
        embeds: ['https://baseposting.online/'],
      })
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
      const shareText = `I just generated a Base banger with BasePosting. Try it: https://baseposting.online/` // keep it simple
      const cast = await composeCast({
        text: shareText,
        embeds: ['https://baseposting.online/'],
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

      // Chain handling (non-negotiable)
      const chainId = (await provider.request({ method: 'eth_chainId' })) as string
      if (chainId !== '0x2105' && chainId !== '0x14a34') {
        try {
          await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x2105' }],
          })
        } catch (e: any) {
          throw new Error('Please switch to Base Mainnet (0x2105) in your wallet to continue.')
        }
      }

      const dataSuffix = (window as any).__ERC8021_DATA_SUFFIX__

      const request: any = {
        method: 'eth_sendTransaction',
        params: [
          {
            from: addr,
            to: CONTRACT,
            value: '0x0',
            data: '0x'
          },
        ],
      }

      // Builder attribution capability (best-effort)
      if (dataSuffix) {
        request.capabilities = { dataSuffix }
      }

      const txHash = (await provider.request(request)) as string
      toast.message('Tx sent. Verifying…')

      const verified = await apiVerifyTx(identity.fid ? identity : { address: addr }, txHash)
      setCredits(verified.credits)
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
                Open <span className="font-semibold">https://baseposting.online/</span> from inside a Farcaster client (Warpcast / Base app), not a normal browser.
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
              <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Scrape X → generate Base bangers that feel like you wrote them.</div>
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
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Generate</div>
              <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">One tap → one Base-style banger. No prompt needed.</div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-2">
                  <Button
                    className="w-full sm:w-auto"
                    variant="primary"
                    isLoading={generating || loadingMe}
                    disabled={!canGenerate}
                    onClick={() => void onGenerate(false)}
                  >
                    <Sparkles className="h-4 w-4" />
                    Generate
                  </Button>

                  {result && (credits ?? 0) > 0 ? (
                    <Button
                      className="w-full sm:w-auto"
                      variant="secondary"
                      disabled={!canGenerate}
                      onClick={() => void onGenerate(true)}
                    >
                      Regenerate
                    </Button>
                  ) : null}
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    variant="secondary"
                    isLoading={gettingCredit}
                    onClick={() => void onGetCredit()}
                    disabled={!miniLoaded}
                  >
                    <Wallet className="h-4 w-4" />
                    Get Credit
                  </Button>

                  <Button
                    variant="ghost"
                    isLoading={sharing}
                    onClick={() => void onShareForCredits()}
                    disabled={!shareEligible}
                  >
                    <Send className="h-4 w-4" />
                    Share for 2 credit
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
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Result</div>
                <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">One click → one unique post.</div>
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
                  <div className="text-sm text-zinc-600 dark:text-zinc-400">Generate to see your post here.</div>
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

          <div className="mt-8 text-center text-xs text-zinc-500 dark:text-zinc-500">
            Runs at <span className="font-semibold">https://baseposting.online/</span>
          </div>
        </div>
      </div>
    </div>
  )
}
