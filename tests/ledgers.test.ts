import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Mock memory + simulated seals: no keys are set when tests run, and every ledger gets a throwaway data dir.
process.env.CALLBOOK_DATA_DIR = await mkdtemp(path.join(tmpdir(), "callbook-ledgers-"));
process.env.USER_MAX_EVENTS = "4";
const L = await import("../src/lib/ledger.ts");
const { commitmentFor } = await import("../src/lib/sui.ts");

const closes = new Date(Date.now() + 3600_000).toISOString();

test("one wallet's ledger is invisible to another's and to the featured ledger", async () => {
  await L.addVoice("u-aaa", "Alice's friend", "friend");
  await L.addVoice("u-bbb", "Bob's pundit", "pundit");
  const a = await L.getState("u-aaa");
  const b = await L.getState("u-bbb");
  const featured = await L.getState(L.FEATURED_NS);
  assert.deepEqual(a.voices.map((v) => v.name), ["Alice's friend"]);
  assert.deepEqual(b.voices.map((v) => v.name), ["Bob's pundit"]);
  assert.equal(featured.voices.length, 0);
});

test("a prediction in one ledger cannot target another ledger's question", async () => {
  const m = await L.addMarket("u-ccc", "Will it rain?", "weather", closes);
  await L.addVoice("u-ddd", "Dana", "self");
  await assert.rejects(L.makeCall("u-ddd", m.id, "dana", 0.6), /Unknown question/);
});

test("user ledgers are capped, the featured ledger is not", async () => {
  for (let i = 0; i < 4; i++) await L.addVoice("u-eee", `Voice ${i}`, "friend");
  await assert.rejects(L.addVoice("u-eee", "One too many", "friend"), /ledger is full/);
  for (let i = 0; i < 6; i++) await L.addVoice(L.FEATURED_NS, `Featured ${i}`, "friend");
  assert.equal((await L.getState(L.FEATURED_NS)).voices.length, 6);
});

test("invalid ledger ids are refused (no path tricks)", async () => {
  await assert.rejects(L.getState("../../etc/passwd"), /Invalid ledger id/);
  await assert.rejects(L.getState("Has Spaces"), /Invalid ledger id/);
});

test("a prediction records its owner and the commitment binds to that wallet", async () => {
  const owner = "0x" + "ab".repeat(32);
  await L.addVoice("u-fff", "Fay", "self");
  const m = await L.addMarket("u-fff", "Will it snow?", "weather", closes);
  const call = await L.makeCall("u-fff", m.id, "fay", 0.4, owner);
  assert.equal(call.owner, owner);
  const base = { marketId: call.marketId, voiceId: call.voiceId, p: call.p, nonce: call.nonce };
  assert.equal(call.commitment, commitmentFor({ ...base, owner }));
  assert.notEqual(call.commitment, commitmentFor(base), "the same call without an owner hashes differently");
});

test("featured-ledger commitments keep their original format (no owner field)", () => {
  const base = { marketId: "m", voiceId: "v", p: 0.5, nonce: "n" };
  const legacy = createHash("sha256").update(JSON.stringify(base)).digest("hex");
  assert.equal(commitmentFor(base), legacy);
});

test("players predict once per question, their profile is created once, and others' open predictions stay private", async () => {
  const ns = L.FEATURED_NS;
  const m = await L.addMarket(ns, "Will the test pass?", "meta", closes);
  const alice = "0x" + "a1".repeat(32);
  const bob = "0x" + "b2".repeat(32);

  const c1 = await L.predict(ns, alice, "w-alice", "Alice", m.id, 0.7);
  assert.equal(c1.owner, alice);
  await assert.rejects(L.predict(ns, alice, "w-alice", "Alice", m.id, 0.2), /already locked in/);
  await L.predict(ns, bob, "w-bob", "Bob", m.id, 0.4);

  const state = await L.getState(ns, "w-alice");
  assert.equal(state.voices.filter((v) => v.id === "w-alice").length, 1, "one profile per player");
  const mine = state.calls.filter((c) => c.marketId === m.id);
  assert.deepEqual(mine.map((c) => c.voiceId), ["w-alice"], "Alice sees only her own prediction while the question is open");
  assert.equal(state.consensus.find((x) => x.marketId === m.id)?.nCalls, 2, "but both count toward the community forecast");

  const anon = await L.getState(ns);
  assert.equal(anon.calls.filter((c) => c.marketId === m.id).length, 0, "visitors see no individual player predictions yet");
});

test("players cannot predict a closed or unknown question", async () => {
  const ns = L.FEATURED_NS;
  const past = await L.addMarket(ns, "Already over?", "meta", new Date(Date.now() - 1000).toISOString());
  await assert.rejects(L.predict(ns, "0x" + "c3".repeat(32), "w-carol", "Carol", past.id, 0.5), /closed/);
  await assert.rejects(L.predict(ns, "0x" + "c3".repeat(32), "w-carol", "Carol", "nope", 0.5), /Unknown question/);
});
