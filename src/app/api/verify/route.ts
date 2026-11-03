import { readAccess } from "@/lib/access.ts";
import { reverify } from "@/lib/ledger.ts";
import { body, handle, rateLimit, str } from "@/lib/http.ts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const b = await body(req);
  return handle(async () => {
    rateLimit(req, "verify", 30, 60_000);
    const a = await readAccess(req);
    return reverify(a.ns, str(b.callId, "callId"));
  });
}
