import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { SuiGraphQLClient } from "@mysten/sui/graphql";

/**
 * Sign in with a Sui wallet: the server hands out a short-lived nonce, the wallet signs a message
 * containing it (free, no transaction), the server verifies the signature and sets a session cookie.
 * Sessions are stateless: an HMAC-signed address plus expiry.
 */
const ephemeralSecret = randomBytes(32).toString("hex");
const secret = () => process.env.SESSION_SECRET || ephemeralSecret; // without SESSION_SECRET, sessions reset on restart

const mac = (s: string) => createHmac("sha256", secret()).update(s).digest("base64url");
const safeEqual = (a: string, b: string) => {
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db);
};

export const SESSION_COOKIE = "cb_session";
const NONCE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 7 * 24 * 3600_000;

export function newNonce(now = Date.now()): string {
  const body = `${now}.${randomBytes(8).toString("hex")}`;
  return `${body}.${mac(`nonce:${body}`)}`;
}

export function signInMessage(nonce: string): string {
  return `Sign in to CallBook\n\nThis proves you control this wallet. It costs nothing and sends no transaction.\n\nNonce: ${nonce}`;
}

function checkNonce(nonce: string, now: number): void {
  const parts = nonce.split(".");
  if (parts.length !== 3) throw new Error("Bad sign-in nonce");
  const body = `${parts[0]}.${parts[1]}`;
  if (!safeEqual(parts[2], mac(`nonce:${body}`))) throw new Error("Bad sign-in nonce");
  const issued = Number(parts[0]);
  if (!Number.isFinite(issued) || now - issued > NONCE_TTL_MS || issued > now + 60_000) throw new Error("Sign-in request expired. Try again.");
}

/** Verifies the wallet's signature over the exact sign-in message; returns the normalized address. */
export async function verifySignIn(address: string, signature: string, message: string, now = Date.now()): Promise<string> {
  const m = message.match(/Nonce: (\S+)$/);
  if (!m || message !== signInMessage(m[1])) throw new Error("Unexpected sign-in message");
  checkNonce(m[1], now);
  const claimed = normalizeSuiAddress(address);
  let publicKey;
  try {
    // zkLogin accounts (Google sign-in in Slush) can only be verified with a Sui client; ordinary keys never touch it.
    const client = process.env.TATUM_API_KEY
      ? new SuiGraphQLClient({
          network: "mainnet",
          url: process.env.TATUM_SUI_GRAPHQL_URL ?? "https://sui-mainnet.gateway.tatum.io/graphql",
          headers: { "x-api-key": process.env.TATUM_API_KEY },
        })
      : undefined;
    publicKey = await verifyPersonalMessageSignature(new TextEncoder().encode(message), signature, { address: claimed, client });
  } catch {
    throw new Error("Signature did not verify");
  }
  if (normalizeSuiAddress(publicKey.toSuiAddress()) !== claimed) throw new Error("Signature does not match that address");
  return claimed;
}

export function createSessionToken(address: string, now = Date.now()): string {
  const payload = `${address}.${now + SESSION_TTL_MS}`;
  return `${Buffer.from(payload).toString("base64url")}.${mac(`sess:${payload}`)}`;
}

export function readSessionToken(token: string | undefined, now = Date.now()): string | null {
  if (!token) return null;
  const [enc, sig] = token.split(".");
  if (!enc || !sig) return null;
  const payload = Buffer.from(enc, "base64url").toString("utf8");
  if (!safeEqual(sig, mac(`sess:${payload}`))) return null;
  const i = payload.lastIndexOf(".");
  const exp = Number(payload.slice(i + 1));
  if (!Number.isFinite(exp) || exp < now) return null;
  return payload.slice(0, i);
}

export function sessionFrom(req: Request): { address: string } | null {
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  const address = readSessionToken(m?.[1]);
  return address ? { address } : null;
}

export function sessionCookie(token: string, maxAgeSec = SESSION_TTL_MS / 1000): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

/** One namespace per wallet: stable, opaque, and safe to use as a file name. */
export function userNamespace(address: string): string {
  return `u-${createHash("sha256").update(normalizeSuiAddress(address)).digest("hex").slice(0, 32)}`;
}

/** A guest has no wallet: a random id bound to this browser by the signed session cookie. */
export const newGuestId = () => `guest-${randomBytes(6).toString("hex")}`;
export const isGuest = (subject: string) => subject.startsWith("guest-");

/** A signed-in player's forecaster id on the shared ledger (wallet address or guest id). */
export function voiceIdFor(subject: string): string {
  if (isGuest(subject)) return `g-${createHash("sha256").update(subject).digest("hex").slice(0, 12)}`;
  return `w-${createHash("sha256").update(normalizeSuiAddress(subject)).digest("hex").slice(0, 12)}`;
}

export const shortAddress = (subject: string) => (isGuest(subject) ? `Guest ${subject.slice(-4).toUpperCase()}` : `${subject.slice(0, 6)}…${subject.slice(-4)}`);
