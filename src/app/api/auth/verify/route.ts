import { NextResponse } from "next/server";
import { createSessionToken, sessionCookie, userNamespace, verifySignIn } from "@/lib/auth.ts";
import { body, HttpError, rateLimit, str } from "@/lib/http.ts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    rateLimit(req, "auth", 20, 60_000);
    const b = await body(req);
    const address = await verifySignIn(str(b.address, "address"), str(b.signature, "signature"), str(b.message, "message"));
    const res = NextResponse.json({ address, ledger: userNamespace(address) });
    res.headers.append("set-cookie", sessionCookie(createSessionToken(address)));
    return res;
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 401;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
