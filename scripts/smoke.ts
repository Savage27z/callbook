// End-to-end smoke test of the ledger (mock memory + simulated seals unless .env keys are set).
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

process.env.CALLBOOK_DATA_DIR = await mkdtemp(path.join(tmpdir(), "callbook-"));
const L = await import("../src/lib/ledger.ts");
const NS = L.FEATURED_NS;

await L.addVoice(NS, "Sharp", "friend");
await L.addVoice(NS, "Hype", "pundit");
const closes = new Date(Date.now() + 3600_000).toISOString();
const m1 = await L.addMarket(NS, "Chiefs beat Bills", "nfl", closes);
const m2 = await L.addMarket(NS, "Packers beat Bears", "nfl", closes);
await L.makeCall(NS, m1.id, "sharp", 0.8);
await L.makeCall(NS, m1.id, "hype", 0.95);
await L.makeCall(NS, m2.id, "sharp", 0.7);
await L.makeCall(NS, m2.id, "hype", 0.2);

const diff = await L.resolveMarket(NS, m1.id, false);
console.log("diff", JSON.stringify(diff.voices.map((v) => [v.voiceId, +v.before.toFixed(2), +v.after.toFixed(2)])));

await L.flush();
const state = await L.getState(NS);
assert.equal(state.pendingWrites, 0, "everything is stored after the flush");
const w = Object.fromEntries(state.weights.map((x) => [x.voiceId, x.overall]));
assert.ok(w.hype < w.sharp, "overconfident miss is weighted lower");
assert.equal(state.memoriesWritten, 2 + 2 + 4 + 1);

const rebuilt = await L.rebuildFromMemory(NS);
console.log("rebuild", rebuilt);
assert.equal(rebuilt.recalled, state.memoriesWritten, "every event is recalled from memory");
assert.equal(rebuilt.matchesBefore, true, "weights identical after rebuilding from memory");
console.log("smoke ok", state.modes);
