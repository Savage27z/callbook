import { newNonce, signInMessage } from "@/lib/auth.ts";
import { handle } from "@/lib/http.ts";

export const dynamic = "force-dynamic";

export const GET = () =>
  handle(async () => {
    const nonce = newNonce();
    return { nonce, message: signInMessage(nonce) };
  });
