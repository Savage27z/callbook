import { NextResponse } from "next/server";
import { createSessionToken, newGuestId, sessionCookie } from "@/lib/auth.ts";
import { HttpError, rateLimit } from "@/lib/http.ts";

export const dynamic = "force-dynamic";

// Play without a wallet. The guest id lives only in this browser's signed cookie; making a prediction is what
// creates a player (and the total number of players is capped), so handing out ids costs nothing.
export async function POST(req: Request) {
  try {
    rateLimit(req, "guest", 10, 3600_000);
    const id = newGuestId();
    const res = NextResponse.json({ address: id, guest: true });
    res.headers.append("set-cookie", sessionCookie(createSessionToken(id)));
    return res;
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
