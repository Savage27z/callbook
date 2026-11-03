import assert from "node:assert/strict";
import { test } from "node:test";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { createSessionToken, newNonce, readSessionToken, signInMessage, userNamespace, verifySignIn } from "../src/lib/auth.ts";

async function signIn(kp: Ed25519Keypair, message = signInMessage(newNonce())) {
  const { signature } = await kp.signPersonalMessage(new TextEncoder().encode(message));
  return { message, signature, address: kp.toSuiAddress() };
}

test("a wallet that signs the sign-in message gets its own address back", async () => {
  const kp = Ed25519Keypair.generate();
  const { message, signature, address } = await signIn(kp);
  assert.equal(await verifySignIn(address, signature, message), address);
});

test("claiming someone else's address fails", async () => {
  const mallory = Ed25519Keypair.generate();
  const victim = Ed25519Keypair.generate();
  const { message, signature } = await signIn(mallory);
  await assert.rejects(verifySignIn(victim.toSuiAddress(), signature, message));
});

test("a tampered message, a made-up nonce and an expired nonce are all refused", async () => {
  const kp = Ed25519Keypair.generate();
  const { message, signature, address } = await signIn(kp);
  await assert.rejects(verifySignIn(address, signature, message.replace("costs nothing", "costs everything")));

  const forged = signInMessage("1.2.3");
  const forgedSig = await signIn(kp, forged);
  await assert.rejects(verifySignIn(address, forgedSig.signature, forged));

  await assert.rejects(verifySignIn(address, signature, message, Date.now() + 10 * 60_000), /expired/i);
});

test("session tokens round-trip, and tampering or expiry is rejected", () => {
  const a = "0x" + "ab".repeat(32);
  const token = createSessionToken(a);
  assert.equal(readSessionToken(token), a);
  assert.equal(readSessionToken(token + "x"), null);
  assert.equal(readSessionToken(undefined), null);
  const [enc, sig] = token.split(".");
  const forgedPayload = Buffer.from(`0x${"cd".repeat(32)}.${Date.now() + 1e9}`).toString("base64url");
  assert.equal(readSessionToken(`${forgedPayload}.${sig}`), null, "a different payload cannot reuse an old signature");
  assert.ok(enc.length > 10);
  assert.equal(readSessionToken(token, Date.now() + 8 * 24 * 3600_000), null, "sessions expire after 7 days");
});

test("each wallet gets its own stable ledger namespace", () => {
  const a = "0x" + "ab".repeat(32);
  const b = "0x" + "cd".repeat(32);
  assert.equal(userNamespace(a), userNamespace(a));
  assert.notEqual(userNamespace(a), userNamespace(b));
  assert.match(userNamespace(a), /^u-[0-9a-f]{32}$/);
});
