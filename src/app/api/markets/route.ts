import { writeAccess } from "@/lib/access.ts";
import { addMarket } from "@/lib/ledger.ts";
import { body, handle, str } from "@/lib/http.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const b = await body(req);
  return handle(async () => {
    const a = await writeAccess(req);
    return addMarket(a.ns, str(b.question, "question"), str(b.category, "category"), str(b.closesAt, "closesAt"));
  });
}
