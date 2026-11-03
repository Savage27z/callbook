import { writeAccess } from "@/lib/access.ts";
import { loadDemo, resetDemo } from "@/lib/ledger.ts";
import { body, handle } from "@/lib/http.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const b = await body(req);
  return handle(async () => {
    const a = await writeAccess(req);
    if (b.action === "reset") await resetDemo(a.ns);
    else if (b.action === "load") await loadDemo(a.ns);
    else throw new Error('action must be "load" or "reset"');
    return { ok: true };
  });
}
