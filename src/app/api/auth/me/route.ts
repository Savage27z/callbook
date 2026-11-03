import { sessionFrom } from "@/lib/auth.ts";
import { handle } from "@/lib/http.ts";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => handle(async () => ({ address: sessionFrom(req)?.address ?? null }));
