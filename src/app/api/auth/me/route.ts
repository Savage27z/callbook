import { isGuest, sessionFrom } from "@/lib/auth.ts";
import { handle } from "@/lib/http.ts";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => handle(async () => {
    const s = sessionFrom(req);
    return { address: s?.address ?? null, guest: s ? isGuest(s.address) : false };
  });
