import { sessionFrom, shortAddress, voiceIdFor } from "@/lib/auth.ts";
import { body, handle, HttpError, rateLimit, str } from "@/lib/http.ts";
import { FEATURED_NS, predict } from "@/lib/ledger.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// A signed-in player locks in their own prediction. Each costs the operator a tiny Sui seal, so it is rate limited.
export async function POST(req: Request) {
  const b = await body(req);
  return handle(async () => {
    const s = sessionFrom(req);
    if (!s) throw new HttpError("Sign in to make a prediction", 401);
    rateLimit(req, "predict", 20, 60_000);
    return predict(FEATURED_NS, s.address, voiceIdFor(s.address), shortAddress(s.address), str(b.marketId, "marketId"), Number(b.p));
  });
}
