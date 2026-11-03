import { writeAccess } from "@/lib/access.ts";
import { addVoice } from "@/lib/ledger.ts";
import { body, handle, str } from "@/lib/http.ts";
import type { VoiceKind } from "@/lib/types.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const KINDS: VoiceKind[] = ["friend", "pundit", "model", "self"];

export async function POST(req: Request) {
  const b = await body(req);
  return handle(async () => {
    const a = await writeAccess(req);
    const kind = KINDS.includes(b.kind as VoiceKind) ? (b.kind as VoiceKind) : "friend";
    return addVoice(a.ns, str(b.name, "name"), kind);
  });
}
