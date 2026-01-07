// lib/auth.ts
import { createClient, Errors } from "@farcaster/quick-auth";

const client = createClient();

export type MiniAppUser = {
  fid: number;
};

export class AuthError extends Error {
  status = 401 as const;
  constructor(message = "Unauthorized") {
    super(message);
  }
}

export async function requireMiniAppUserFromHeaders(headers: {
  authorization?: string | string[];
}): Promise<MiniAppUser> {
  const raw = headers.authorization;
  const authorization = Array.isArray(raw) ? raw[0] : raw;

  if (!authorization || !authorization.startsWith("Bearer ")) {
    throw new AuthError("Missing token");
  }

  const token = authorization.slice("Bearer ".length).trim();

  try {
    const payload = await client.verifyJwt({
      token,
      domain: "baseposting.online"
    });

    // payload.sub = fid (number)
    return { fid: payload.sub };
  } catch (e) {
    if (e instanceof Errors.InvalidTokenError) {
      throw new AuthError("Invalid token");
    }
    throw e;
  }
}
