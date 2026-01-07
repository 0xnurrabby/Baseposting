import { createClient, Errors } from "@farcaster/quick-auth";
import type { NextApiRequest } from "next";

const client = createClient();

/**
 * Domain must EXACTLY match the deployed hostname per Quick Auth.
 * (No scheme, no path.)
 */
export const HOSTNAME = "baseposting.online";

export type AuthUser = {
  fid: number;
};

export async function requireUser(req: NextApiRequest): Promise<AuthUser> {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    throw Object.assign(new Error("Missing token"), { statusCode: 401 });
  }
  const token = auth.slice("Bearer ".length).trim();
  try {
    const payload = await client.verifyJwt({ token, domain: HOSTNAME });
    return { fid: payload.sub };
  } catch (e) {
    if (e instanceof Errors.InvalidTokenError) {
      throw Object.assign(new Error("Invalid token"), { statusCode: 401 });
    }
    throw Object.assign(new Error("Auth error"), { statusCode: 401 });
  }
}
