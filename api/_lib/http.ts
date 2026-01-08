import type { VercelRequest, VercelResponse } from "@vercel/node";

export function json(res: VercelResponse, status: number, data: unknown) {
  res.status(status);
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.send(JSON.stringify(data));
}

export function methodNotAllowed(res: VercelResponse) {
  return json(res, 405, { ok: false, error: "Method not allowed" });
}

export function getUserId(req: VercelRequest): string | null {
  const id = String(req.headers["x-user-id"] ?? "").trim();
  return id ? id : null;
}

export function parseJsonBody(req: VercelRequest): any {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}
