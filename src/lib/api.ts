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
  if (e?.name === 'AbortError') return new Error('Request timed out. Please wait a little and try again.')
  const msg = String(e?.message || '')
  if (msg.toLowerCase().includes('signal is aborted')) return new Error('Request timed out. Please try again.')
  return e
}

async function safeFetch(input: RequestInfo | URL, init: RequestInit) {
  try {
    return await fetch(input, { ...init, keepalive: true })
  } catch (e: any) {
    throw normalizeClientError(e)
  }
}

async function postJson<T>(path: string, body: any, _timeoutMs = 0): Promise<T> {
  const url = withOrigin(path)
  let lastErr: any = null

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await safeFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      })
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
      if (attempt < 4 && isRetriableError(lastErr)) {
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
  }>('/api/me', identity)
}

/**
 * Streaming version of apiGenerate. Calls `onChunk(partialText)` as tokens
 * arrive, returns the final object when complete.
 *
 * Backward compatible: if you don't pass `onChunk`, it still works — it just
 * accumulates the text and returns it at the end.
 */
export async function apiGenerate(
  identity: Identity,
  prompt: string,
  onChunk?: (partial: string) => void,
): Promise<{ ok: boolean; text: string; credits: number; sourceCount: number }> {
  const url = withOrigin('/api/generate')
  const body = JSON.stringify({ ...identity, prompt })

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    cache: 'no-store',
  })

  // Handle non-OK immediately
  if (!r.ok) {
    const txt = await r.text().catch(() => '')
    let data: any = {}
    try { data = txt ? JSON.parse(txt) : {} } catch { data = { error: txt } }
    const err = new Error(data?.error || `Request failed (${r.status})`)
    ;(err as any).status = r.status
    ;(err as any).data = data
    throw err
  }

  if (!r.body) {
    // No stream body (shouldn't happen, but fallback)
    const txt = await r.text()
    try {
      const data = JSON.parse(txt)
      return { ok: true, text: String(data?.text || ''), credits: Number(data?.credits || 0), sourceCount: Number(data?.sourceCount || 0) }
    } catch {
      return { ok: true, text: txt, credits: 0, sourceCount: 0 }
    }
  }

  const reader = r.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let accumulated = ''
  let finalText = ''
  let credits = 0
  let sourceCount = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const msg = JSON.parse(trimmed)
          if (msg.type === 'meta') {
            credits = Number(msg.credits ?? credits)
            sourceCount = Number(msg.sourceCount ?? sourceCount)
          } else if (msg.type === 'chunk') {
            accumulated += String(msg.text || '')
            if (onChunk) onChunk(accumulated)
          } else if (msg.type === 'final') {
            // Server applied post-processing — replace accumulated with final
            finalText = String(msg.text || '')
            if (onChunk) onChunk(finalText)
          } else if (msg.type === 'done') {
            finalText = String(msg.text || accumulated)
          }
        } catch {
          // Not a valid JSON line — ignore
        }
      }
    }
  } finally {
    try { reader.releaseLock() } catch { /* ignore */ }
  }

  const text = finalText || accumulated
  return { ok: true, text, credits, sourceCount }
}

export async function apiGenerateImage(identity: Identity, text: string, stylePreset?: string) {
  return await postJson<{ ok: boolean; imageUrl: string; imageId: string; imageDataUrl?: string; credits: number }>(
    '/api/generate-image',
    { ...identity, text, ...(stylePreset ? { stylePreset } : {}) },
  )
}

export async function apiVerifyTx(identity: Identity, txHash: string) {
  return await postJson<{ ok: boolean; alreadyCounted?: boolean; pending?: boolean; credits: number }>(
    '/api/verify-tx',
    { ...identity, txHash },
  )
}

export async function apiShareAward(identity: Identity) {
  return await postJson<{ ok: boolean; alreadyClaimed: boolean; credits: number; todayUtc: string }>(
    '/api/share-award',
    { ...identity },
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
  const r = await safeFetch(url, { method: 'GET', cache: 'no-store' })
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
  const r = await safeFetch(url, { method: 'GET', cache: 'no-store' })
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
  )
}
