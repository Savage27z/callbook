import { writeAccess } from "@/lib/access.ts";
import { resolveMarket } from "@/lib/ledger.ts";
import { body, handle, str } from "@/lib/http.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const b = await body(req);
  return handle(async () => {
    const a = await writeAccess(req);
    return resolveMarket(a.ns, str(b.marketId, "marketId"), b.yes === true);
  });
}
