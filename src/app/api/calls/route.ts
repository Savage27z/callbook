import { writeAccess } from "@/lib/access.ts";
import { makeCall } from "@/lib/ledger.ts";
import { body, handle, str } from "@/lib/http.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Operator route: log a prediction for an expert (a forecasting site, a pundit, a model). Players use /api/predict.
export async function POST(req: Request) {
  const b = await body(req);
  return handle(async () => {
    const a = await writeAccess(req);
    return makeCall(a.ns, str(b.marketId, "marketId"), str(b.voiceId, "voiceId"), Number(b.p));
  });
}
