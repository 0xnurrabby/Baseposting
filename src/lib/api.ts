export type Identity = { fid?: number; address?: string }

const API_ORIGIN =
  import.meta.env.VITE_API_ORIGIN ||
  window.location.origin

function withOrigin(path: string) {
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  return `${API_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function isRetriableError(e: any) {
  const msg = String(e?.message || '').toLowerCase()
  return (
    e?.name === 'AbortError' ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('load failed') ||
    msg.includes('aborted')
  )
}

function normalizeClientError(e: any) {
  if (e?.name === 'AbortError') {
    return new Error('Request timed out. Please wait a little and try again.')
  }
  const msg = String(e?.message || '')
  if (msg.toLowerCase().includes('signal is aborted')) {
    return new Error('Request timed out. Please try again.')
  }
  return e
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = 12000) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (e: any) {
    throw normalizeClientError(e)
  } finally {
    clearTimeout(t)
  }
}

async function postJson<T>(path: string, body: any, timeoutMs = 90000): Promise<T> {
  const url = withOrigin(path)
  let lastErr: any = null

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          cache: 'no-store',
        },
        timeoutMs,
      )
      const txt = await r.text()
      let data: any
      try {
        data = txt ? JSON.parse(txt) : {}
      } catch {
        data = { error: txt }
      }
      if (!r.ok) {
        const err = new Error(data?.error || `Request failed (${r.status})`)
        ;(err as any).status = r.status
        ;(err as any).data = data
        throw err
      }
      return data as T
    } catch (e: any) {
      lastErr = normalizeClientError(e)
      if (attempt < 2 && isRetriableError(lastErr)) {
        await sleep(600 * (attempt + 1))
        continue
      }
      throw lastErr
    }
  }

  throw normalizeClientError(lastErr)
}

export async function apiMe(identity: Identity) {
  return await postJson<{
    ok: boolean
    user: { id: string; credits: number; lastShareAt: string | null }
    share: { canClaimToday: boolean; todayUtc: string }
  }>('/api/me', identity, 30000)
}

export async function apiGenerate(identity: Identity, prompt: string) {
  return await postJson<{ ok: boolean; text: string; credits: number; sourceCount: number }>(
    '/api/generate',
    { ...identity, prompt },
    20000,
  )
}

export async function apiGenerateImage(identity: Identity, text: string, stylePreset?: string) {
  return await postJson<{ ok: boolean; imageUrl: string; imageId: string; credits: number }>(
    '/api/generate-image',
    { ...identity, text, ...(stylePreset ? { stylePreset } : {}) },
    25000,
  )
}

export async function apiVerifyTx(identity: Identity, txHash: string) {
  return await postJson<{ ok: boolean; alreadyCounted?: boolean; pending?: boolean; credits: number }>(
    '/api/verify-tx',
    { ...identity, txHash },
    20000,
  )
}

export async function apiShareAward(identity: Identity) {
  return await postJson<{ ok: boolean; alreadyClaimed: boolean; credits: number; todayUtc: string }>(
    '/api/share-award',
    { ...identity },
    30000,
  )
}

export type LeaderboardPeriod = '7d' | 'prev'
export type LeaderboardRow = {
  userId: string
  fid: number | null
  creditsSpent: number
  postCount: number
  photoCount: number
  displayName?: string
  username?: string
  pfpUrl?: string
  baseAddress?: string | null
  rewardUsd?: number | null
}

export async function apiLeaderboard(period: LeaderboardPeriod) {
  const url = withOrigin(`/api/leaderboard?period=${encodeURIComponent(period)}`)
  const r = await fetchWithTimeout(url, { method: 'GET', cache: 'no-store' }, 15000)
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const err = new Error((data as any)?.error || `Request failed (${r.status})`)
    ;(err as any).status = r.status
    ;(err as any).data = data
    throw err
  }
  return data as { ok: boolean; period: LeaderboardPeriod; entries: LeaderboardRow[]; meta: any }
}

export async function apiGetRewardAddress(fid: number) {
  const url = withOrigin(`/api/reward-address?fid=${encodeURIComponent(String(fid))}`)
  const r = await fetchWithTimeout(url, { method: 'GET', cache: 'no-store' }, 15000)
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const err = new Error((data as any)?.error || `Request failed (${r.status})`)
    ;(err as any).status = r.status
    ;(err as any).data = data
    throw err
  }
  return data as { ok: boolean; userId: string; baseAddress: string | null }
}

export async function apiSetRewardAddress(identity: Identity, baseAddress: string) {
  return await postJson<{ ok: boolean; userId: string; baseAddress: string }>(
    '/api/reward-address',
    { ...identity, baseAddress },
    30000,
  )
}
