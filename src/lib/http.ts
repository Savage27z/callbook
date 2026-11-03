import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    return NextResponse.json(await fn());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: err instanceof HttpError ? err.status : 400 });
  }
}

export async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await req.json();
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function str(v: unknown, name: string): string {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${name} is required`);
  return v;
}

/**
 * Writes spend the sealer's SUI and write to the Walrus account, so they need an admin token.
 * Reads stay public. With no ADMIN_TOKEN: open in development, locked in production.
 */
export function adminRequired(): boolean {
  return Boolean(process.env.ADMIN_TOKEN) || process.env.NODE_ENV === "production";
}

const digest = (s: string) => createHash("sha256").update(s).digest();

export function isAdmin(req: Request): boolean {
  if (!adminRequired()) return true;
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false; // production without a token: nobody can write
  return timingSafeEqual(digest(req.headers.get("x-admin-token") ?? ""), digest(expected));
}

const fails = new Map<string, { n: number; t: number }>();
const WINDOW_MS = 60_000;
const MAX_FAILS = 10;

/** Throws 401 unless the request carries the admin token; slows down guessing per client. */
export function requireAdmin(req: Request): void {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  const now = Date.now();
  const prior = fails.get(ip);
  const cur = prior && now - prior.t < WINDOW_MS ? prior : { n: 0, t: now };
  if (cur.n >= MAX_FAILS) throw new HttpError("Too many failed attempts. Wait a minute.", 429);
  if (isAdmin(req)) return;
  cur.n++;
  fails.set(ip, cur);
  throw new HttpError(process.env.ADMIN_TOKEN ? "Admin token required" : "Writes are disabled: this deployment has no ADMIN_TOKEN set", 401);
}

const buckets = new Map<string, { n: number; t: number }>();

/** Simple fixed-window limiter per client and bucket (in memory; fine for a single-server demo). */
export function rateLimit(req: Request, bucket: string, max: number, windowMs: number): void {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const cur = buckets.get(key);
  const b = cur && now - cur.t < windowMs ? cur : { n: 0, t: now };
  b.n++;
  buckets.set(key, b);
  if (b.n > max) throw new HttpError("Too many requests. Slow down a little.", 429);
}
