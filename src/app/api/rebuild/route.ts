import { writeAccess } from "@/lib/access.ts";
import { rebuildFromMemory } from "@/lib/ledger.ts";
import { handle } from "@/lib/http.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = (req: Request) =>
  handle(async () => {
    const a = await writeAccess(req);
    return rebuildFromMemory(a.ns);
  });
