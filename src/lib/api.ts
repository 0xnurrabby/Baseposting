import { nanoid } from "nanoid";

export type CreditsResponse = {
  ok: true;
  userId: string;
  credits: number;
  lastShareUtcDate?: string | null;
};

export type GenerateResponse = {
  ok: true;
  userId: string;
  credits: number;
  post: string;
  sourcesUsed: number;
};

export type ErrorResponse = {
  ok: false;
  error: string;
  credits?: number;
};

export function stableAnonId() {
  const key = "bp_anon_id_v1";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const v = nanoid();
  localStorage.setItem(key, v);
  return v;
}

export async function apiGet<T>(path: string, userId: string): Promise<T> {
  const res = await fetch(path, { headers: { "x-user-id": userId } });
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, userId: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}
