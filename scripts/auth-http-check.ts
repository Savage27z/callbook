// End-to-end check of wallet sign-in and player predictions over real HTTP.
// Run against a server in MOCK mode (no Walrus/Sui keys) so nothing is written to mainnet:
//   node --experimental-strip-types scripts/auth-http-check.ts http://localhost:3100
import assert from "node:assert/strict";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

const base = process.argv[2] ?? "http://localhost:3100";
const tomorrow = new Date(Date.now() + 24 * 3600_000).toISOString();

async function login(kp: Ed25519Keypair): Promise<string> {
  const { message } = (await (await fetch(`${base}/api/auth/nonce`)).json()) as { message: string };
  const { signature } = await kp.signPersonalMessage(new TextEncoder().encode(message));
  const res = await fetch(`${base}/api/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: kp.toSuiAddress(), signature, message }),
  });
  assert.equal(res.status, 200, `login failed: ${await res.clone().text()}`);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("cb_session="));
  assert.ok(cookie && /HttpOnly/.test(cookie), "HttpOnly session cookie set");
  return cookie!.split(";")[0];
}

const post = (cookie: string | null, path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const state = async (cookie: string | null) =>
  (await (await fetch(`${base}/api/state`, { headers: cookie ? { cookie } : {} })).json()) as {
    calls: { marketId: string; voiceId: string; p: number }[];
    voices: { id: string; name: string; kind: string }[];
    consensus: { marketId: string; nCalls: number }[];
    viewer: { address: string; voiceId: string } | null;
  };

const a = await login(Ed25519Keypair.generate());
const b = await login(Ed25519Keypair.generate());

const market = (await (await post(null, "/api/markets", { question: "HTTP check question?", category: "meta", closesAt: tomorrow })).json()) as { id: string };
assert.ok(market.id, "operator created a question");

assert.equal((await post(null, "/api/predict", { marketId: market.id, p: 0.6 })).status, 401, "predicting needs a signed-in wallet");
assert.equal((await post("cb_session=forged.token", "/api/predict", { marketId: market.id, p: 0.6 })).status, 401, "a forged cookie is refused");

assert.equal((await post(a, "/api/predict", { marketId: market.id, p: 0.7 })).status, 200);
assert.equal((await post(a, "/api/predict", { marketId: market.id, p: 0.2 })).status, 400, "predictions are final");
assert.equal((await post(b, "/api/predict", { marketId: market.id, p: 0.3 })).status, 200);

const sa = await state(a);
const anon = await state(null);
assert.equal(sa.viewer?.voiceId?.startsWith("w-"), true);
assert.equal(sa.calls.filter((c) => c.marketId === market.id).length, 1, "a player sees only their own open prediction");
assert.equal(anon.calls.filter((c) => c.marketId === market.id).length, 0, "visitors see none");
assert.equal(sa.consensus.find((c) => c.marketId === market.id)?.nCalls, 2, "both count toward the community forecast");
assert.equal(sa.voices.filter((v) => v.kind === "user").length, 2);
console.log("sign-in + predictions OK");
