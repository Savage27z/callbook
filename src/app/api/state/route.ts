import { readAccess } from "@/lib/access.ts";
import { isGuest, sessionFrom, voiceIdFor } from "@/lib/auth.ts";
import { getState } from "@/lib/ledger.ts";
import { handle } from "@/lib/http.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Public read of the shared ledger. `viewer` is the signed-in player (if any); `admin` says whether this
// request may use operator tools; other players' predictions on open questions are hidden from everyone but their owner.
export const GET = (req: Request) =>
  handle(async () => {
    const a = await readAccess(req);
    const s = sessionFrom(req);
    const viewerVoiceId = s ? voiceIdFor(s.address) : undefined;
    return {
      ...(await getState(a.ns, viewerVoiceId)),
      admin: a.canWrite,
      adminRequired: a.adminRequired,
      viewer: s ? { address: s.address, voiceId: viewerVoiceId, guest: isGuest(s.address) } : null,
    };
  });
