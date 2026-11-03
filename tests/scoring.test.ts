import assert from "node:assert/strict";
import { test } from "node:test";
import { brier, consensus, countsAsProof, diffForResolution, project, weightFor, weights } from "../src/lib/scoring.ts";
import type { Call, LedgerEvent, Market } from "../src/lib/types.ts";

const market = (id: string, category = "nfl", closesAt = "2026-11-10T00:00:00Z"): Market => ({ id, question: id, category, closesAt });
const call = (id: string, marketId: string, voiceId: string, p: number, verified = true, ts = Date.parse("2026-11-01T00:00:00Z")): Call => ({
  id,
  marketId,
  voiceId,
  p,
  nonce: "n",
  commitment: "c",
  seal: { mode: "sui-mainnet", verified, timestampMs: ts, digest: "d" },
});

function ledger(extra: LedgerEvent[] = []): LedgerEvent[] {
  return [
    { t: "voice", voice: { id: "sharp", name: "Sharp", kind: "friend" } },
    { t: "voice", voice: { id: "hype", name: "Hype", kind: "pundit" } },
    ...extra,
  ];
}

test("brier is zero for a perfect call and 1 for a confidently wrong one", () => {
  assert.equal(brier(1, true), 0);
  assert.equal(brier(0, true), 1);
  assert.equal(brier(0.5, false), 0.25);
});

test("no history means neutral weight", () => {
  assert.equal(weightFor([]), 1);
});

test("one lucky call cannot make an oracle (shrinkage)", () => {
  const w = weightFor([{ p: 0.99, yes: true, category: "nfl" }]);
  assert.ok(w > 1 && w < 1.6, `weight ${w}`);
});

test("consistently right beats consistently wrong, and coin-flip stays near 1", () => {
  const good = Array.from({ length: 10 }, () => ({ p: 0.9, yes: true, category: "nfl" }));
  const bad = Array.from({ length: 10 }, () => ({ p: 0.9, yes: false, category: "nfl" }));
  const coin = Array.from({ length: 10 }, () => ({ p: 0.5, yes: true, category: "nfl" }));
  assert.ok(weightFor(good) > 1.8);
  assert.ok(weightFor(bad) < 0.5);
  assert.ok(Math.abs(weightFor(coin) - 1) < 1e-9);
});

test("category weights fall back toward overall skill when a category has little data", () => {
  const rows = [
    ...Array.from({ length: 8 }, () => ({ p: 0.9, yes: true, category: "nfl" })),
    { p: 0.9, yes: false, category: "politics" },
  ];
  assert.ok(weightFor(rows, "nfl") > weightFor(rows, "politics"));
});

test("simulated or unverified or late seals never count as proof", () => {
  const m = market("m1");
  assert.equal(countsAsProof(call("a", "m1", "sharp", 0.7), m), true);
  assert.equal(countsAsProof(call("a", "m1", "sharp", 0.7, false), m), false);
  assert.equal(countsAsProof({ ...call("a", "m1", "sharp", 0.7), seal: { mode: "simulated", verified: false, timestampMs: 1 } }, m), false);
  assert.equal(countsAsProof(call("a", "m1", "sharp", 0.7, true, Date.parse("2026-11-11T00:00:00Z")), m), false);
});

test("resolution moves weights and the consensus of open markets", () => {
  const events = ledger([
    { t: "market", market: market("past") },
    { t: "market", market: market("open") },
    { t: "call", call: call("c1", "past", "sharp", 0.9) },
    { t: "call", call: call("c2", "past", "hype", 0.9) },
    { t: "call", call: call("c3", "open", "sharp", 0.8) },
    { t: "call", call: call("c4", "open", "hype", 0.2) },
  ]);
  const naive = consensus(project(events), false).find((c) => c.marketId === "open")!;
  assert.equal(Math.round(naive.weighted * 100), 50, "equal weights before any grading");

  const diff = diffForResolution(events, "past", true, false);
  assert.equal(diff.voices.length, 2);

  // Both said 90% and it happened; make hype wrong on a second market to separate them.
  const events2: LedgerEvent[] = [
    ...events,
    { t: "resolution", resolution: { marketId: "past", yes: true, resolvedAt: "x" } },
    { t: "market", market: market("past2") },
    { t: "call", call: call("c5", "past2", "sharp", 0.8) },
    { t: "call", call: call("c6", "past2", "hype", 0.95) },
  ];
  const d2 = diffForResolution(events2, "past2", false, false);
  const sharp = d2.voices.find((v) => v.voiceId === "sharp")!;
  const hype = d2.voices.find((v) => v.voiceId === "hype")!;
  assert.ok(hype.after < sharp.after, "overconfident miss is punished harder");
  const open = d2.consensus.find((c) => c.marketId === "open")!;
  assert.ok(open.after > open.before, "consensus on the open market tilts toward the sharper voice (who said 80%)");
});

test("weights() ignores unverified calls when simulation is not allowed", () => {
  const events = ledger([
    { t: "market", market: market("m1") },
    { t: "call", call: call("c1", "m1", "sharp", 0.9, false) },
    { t: "resolution", resolution: { marketId: "m1", yes: true, resolvedAt: "x" } },
  ]);
  const w = weights(project(events), false).find((x) => x.voiceId === "sharp")!;
  assert.equal(w.nResolved, 0);
  const w2 = weights(project(events), true).find((x) => x.voiceId === "sharp")!;
  assert.equal(w2.nResolved, 1);
});

test("a void event cancels a resolution and the market can be resolved again", () => {
  const base: LedgerEvent[] = ledger([
    { t: "market", market: market("m1") },
    { t: "call", call: call("c1", "m1", "sharp", 0.9) },
    { t: "resolution", resolution: { marketId: "m1", yes: true, resolvedAt: "x" } },
  ]);
  assert.equal(project(base).resolved.get("m1"), true);
  const voided: LedgerEvent[] = [...base, { t: "void", marketId: "m1", reason: "resolved by mistake" }];
  assert.equal(project(voided).resolved.has("m1"), false);
  assert.equal(weights(project(voided), false).find((w) => w.voiceId === "sharp")!.nResolved, 0, "voided results are not graded");
  const again: LedgerEvent[] = [...voided, { t: "resolution", resolution: { marketId: "m1", yes: false, resolvedAt: "y" } }];
  assert.equal(project(again).resolved.get("m1"), false);
});
