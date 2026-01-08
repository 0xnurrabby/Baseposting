export type Identity = { fid?: number; address?: string }

async function postJson<T>(path: string, body: any): Promise<T> {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

export async function apiVerifyTx(identity: Identity, txHash: string) {
  return await postJson<{ ok: boolean; alreadyCounted: boolean; credits: number }>(
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
