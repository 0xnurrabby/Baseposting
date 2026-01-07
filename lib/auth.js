/**
 * Quick Auth verification (best-effort, resilient across minor API changes).
 * - Frontend should use sdk.quickAuth.fetch(...) which attaches Authorization: Bearer <JWT>.
 * - Backend verifies JWT and extracts fid.
 *
 * If verification fails (missing package API changes / token missing), we return null.
 * Endpoints that require auth should reject if fid is null.
 */

function getBearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization;
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

async function verifyQuickAuthToken(token) {
  const qa = require("@farcaster/quick-auth");

  // Create client
  let client = null;
  if (typeof qa.createClient === "function") {
    client = qa.createClient(); // common pattern
  } else if (typeof qa.QuickAuthClient === "function") {
    client = new qa.QuickAuthClient();
  } else if (typeof qa.default === "function") {
    client = qa.default();
  }

  if (!client) throw new Error("Unable to create Quick Auth client.");

  // Try known method names
  const candidates = [
    "verifyJwt",
    "verifyJWT",
    "verifyToken",
    "validate",
    "validateToken",
    "validateSession",
    "validateSessionToken",
    "verifySessionToken",
  ];

  for (const fn of candidates) {
    if (typeof client[fn] === "function") {
      const out = await client[fn](token);
      return out;
    }
  }

  // Some versions export helpers instead of client methods
  const helperCandidates = [
    "verifyJwt",
    "verifyJWT",
    "validateToken",
    "validateSessionToken",
  ];
  for (const fn of helperCandidates) {
    if (typeof qa[fn] === "function") {
      const out = await qa[fn](token);
      return out;
    }
  }

  throw new Error("No compatible Quick Auth verify method found.");
}

function extractFid(verifyResult) {
  if (!verifyResult) return null;

  // Many libs return { payload } or { fid } directly.
  const payload =
    verifyResult.payload ||
    verifyResult.data ||
    verifyResult.session ||
    verifyResult;

  const fid =
    payload.fid ||
    payload.user?.fid ||
    payload.userFid ||
    payload.sub; // sometimes in JWT subject

  const n = Number(fid);
  return Number.isFinite(n) ? n : null;
}

async function requireFid(req) {
  const token = getBearer(req);
  if (!token) return null;
  try {
    const verified = await verifyQuickAuthToken(token);
    return extractFid(verified);
  } catch {
    return null;
  }
}

module.exports = { requireFid };
