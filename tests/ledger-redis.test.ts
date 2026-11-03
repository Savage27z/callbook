import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createRedisStore } from "../src/lib/store.ts";
import { fakeRedis } from "./store.test.ts";

// Run the whole ledger on the Redis store (as on a serverless host) with mock Walrus and simulated seals.
process.env.CALLBOOK_DATA_DIR = await mkdtemp(path.join(tmpdir(), "callbook-redis-"));
(globalThis as unknown as { __callbookStore?: unknown }).__callbookStore = createRedisStore(fakeRedis());
const L = await import("../src/lib/ledger.ts");
const closes = new Date(Date.now() + 3600_000).toISOString();

test("the ledger runs on the redis store end to end", async () => {
  assert.equal(L.storeKind(), "redis");
  const ns = L.FEATURED_NS;
  await L.addVoice(ns, "Sharp", "friend");
  const m = await L.addMarket(ns, "Does redis work?", "meta", closes);
  await L.makeCall(ns, m.id, "sharp", 0.8);
  await L.resolveMarket(ns, m.id, true);
  await L.flush(ns);
  const s = await L.getState(ns);
  assert.equal(s.voices.length, 1);
  assert.equal(s.calls.length, 1);
  assert.equal(s.resolved[m.id], true);
  assert.equal(s.pendingWrites, 0, "everything reached (mock) Walrus");
  assert.equal(s.memoriesWritten, 4);
});

test("two simultaneous predictions by one player on one question: exactly one is accepted", async () => {
  const ns = L.FEATURED_NS;
  const m = await L.addMarket(ns, "Race?", "meta", closes);
  const me = "0x" + "d4".repeat(32);
  const results = await Promise.allSettled([L.predict(ns, me, "w-race", "Racer", m.id, 0.6), L.predict(ns, me, "w-race", "Racer", m.id, 0.3)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const state = await L.getState(ns, "w-race");
  assert.equal(state.calls.filter((c) => c.marketId === m.id && c.voiceId === "w-race").length, 1);
});
