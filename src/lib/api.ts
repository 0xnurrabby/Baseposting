export type Identity = { fid?: number; address?: string }

const API_ORIGIN =
  import.meta.env.VITE_API_ORIGIN ||
  // Default to the current host where this app is served.
  window.location.origin
function withOrigin(path: string) {
  // Always use absolute URLs so Mini App hosts that change the effective origin
  // (preview surfaces, proxies) won't break same-origin fetch.
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  return `${API_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function isNetworkError(e: any) {
  const msg = String(e?.message || '')
  return msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('Load failed')
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs = 20000) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(t)
  }
}

async function postJson<T>(path: string, body: any): Promise<T> {
  const url = withOrigin(path)

  // Small retry for transient Mini App network blips.
  let lastErr: any = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          cache: 'no-store',
        },
        20000
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
      lastErr = e
      if (attempt === 0 && isNetworkError(e)) {
        await sleep(350)
        continue
      }
      throw e
    }
  }
  throw lastErr
}

async function getJson<T>(path: string): Promise<T> {
  const url = withOrigin(path)
  let lastErr: any = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetchWithTimeout(
        url,
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        },
        20000
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
      lastErr = e
      if (attempt === 0 && isNetworkError(e)) {
        await sleep(350)
        continue
      }
      throw e
    }
  }
  throw lastErr
}

export async function apiMe(identity: Identity) {
  return await postJson<{
    ok: boolean
    user: { id: string; credits: number; lastShareAt: string | null }
    share: { canClaimToday: boolean; todayUtc: string }
  }>('/api/me', identity)
}

export async function apiGenerate(identity: Identity, prompt: string) {
  return await postJson<{ ok: boolean; text: string; credits: number; sourceCount: number }>(
    '/api/generate',
    { ...identity, prompt }
  )
}

export async function apiGenerateImage(identity: Identity, text: string) {
  return await postJson<{ ok: boolean; imageUrl: string; imageId: string; credits: number }>(
    '/api/generate-image',
    { ...identity, text }
  )
}

export async function apiVerifyTx(identity: Identity, txHash: string) {
  return await postJson<{ ok: boolean; alreadyCounted?: boolean; pending?: boolean; credits: number }>(
    '/api/verify-tx',
    { ...identity, txHash }
  )
}

export async function apiShareAward(identity: Identity) {
  return await postJson<{ ok: boolean; alreadyClaimed: boolean; credits: number; todayUtc: string }>(
    '/api/share-award',
    { ...identity }
  )
}

export type LeaderboardRange = '7d' | 'prevweek' | 'all'

export type LeaderboardEntry = {
  rank: number
  fid: number | null
  member: string
  name: string
  username: string | null
  pfpUrl: string | null
  spentCredits: number
}

export async function apiLeaderboard(range: LeaderboardRange) {
  const q = encodeURIComponent(range)
  return await getJson<{ ok: boolean; range: LeaderboardRange; updatedAt: string; entries: LeaderboardEntry[] }>(
    `/api/leaderboard?range=${q}`
  )
}

export async function apiRewardAddressGet(fid: number) {
  return await getJson<{ ok: boolean; exists: boolean; record: Record<string, string> | null }>(
    `/api/reward-address?fid=${encodeURIComponent(String(fid))}`
  )
}

export async function apiRewardAddressUpsert(args: {
  fid: number
  address: string
  username?: string
  displayName?: string
  pfpUrl?: string
}) {
  return await postJson<{ ok: boolean; fid: number; address: string }>('/api/reward-address', args)
}
