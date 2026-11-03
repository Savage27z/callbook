import type { Call, Consensus, LedgerEvent, Market, Scored, VoiceWeight } from "./types.ts";

/** Pseudo-observations of "coin flip" skill that every voice starts with. */
const SHRINK_K = 3;
const MIN_WEIGHT = 0.1;
const MAX_WEIGHT = 3;
/** Brier score of always answering 50%. */
const COIN_FLIP = 0.25;

export function brier(p: number, yes: boolean): number {
  const o = yes ? 1 : 0;
  return (p - o) ** 2;
}

/** 1 = perfect, 0 = no better than a coin flip, down to -3 for always confidently wrong. */
function edge(rows: Scored[]): number {
  const mean = rows.reduce((s, r) => s + brier(r.p, r.yes), 0) / rows.length;
  return (COIN_FLIP - mean) / COIN_FLIP;
}

/**
 * Shrunk skill estimate: K pseudo-observations of "coin flip" skill (edge 0) pull every estimate
 * toward neutral, so one lucky call should not make anyone an oracle. A category's estimate also
 * borrows the voice's skill in *other* categories as its prior, so a good voice starts out trusted
 * in a category they have never been graded in.
 */
export function weightFor(rows: Scored[], category?: string): number {
  if (rows.length === 0) return 1;
  let e = (edge(rows) * rows.length) / (rows.length + SHRINK_K);
  if (category) {
    const cat = rows.filter((r) => r.category === category);
    const other = rows.filter((r) => r.category !== category);
    if (cat.length > 0 || other.length > 0) {
      const priorEdge = other.length > 0 ? (edge(other) * other.length) / (other.length + SHRINK_K) : 0;
      const sumCat = cat.length > 0 ? edge(cat) * cat.length : 0;
      e = (sumCat + SHRINK_K * priorEdge) / (cat.length + SHRINK_K);
    }
  }
  return clamp(1 + 2 * e, MIN_WEIGHT, MAX_WEIGHT);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export interface LedgerView {
  markets: Map<string, Market>;
  calls: Call[];
  resolved: Map<string, boolean>;
  voiceIds: string[];
}

export function project(events: LedgerEvent[]): LedgerView {
  const markets = new Map<string, Market>();
  const calls = new Map<string, Call>();
  const resolved = new Map<string, boolean>();
  const voiceIds: string[] = [];
  for (const ev of events) {
    if (ev.t === "voice" && !voiceIds.includes(ev.voice.id)) voiceIds.push(ev.voice.id);
    else if (ev.t === "market") markets.set(ev.market.id, ev.market);
    else if (ev.t === "call") calls.set(ev.call.id, ev.call);
    else if (ev.t === "resolution") resolved.set(ev.resolution.marketId, ev.resolution.yes);
    else if (ev.t === "void") resolved.delete(ev.marketId);
  }
  const ordered = [...calls.values()].sort((a, b) => a.seal.timestampMs - b.seal.timestampMs);
  return { markets, calls: ordered, resolved, voiceIds };
}

/**
 * A call only counts if it was sealed before the market closed. Simulated seals never count
 * toward credibility, so the weights shown in the UI are always backed by real proof.
 */
export function countsAsProof(call: Call, market: Market | undefined): boolean {
  if (!market) return false;
  return call.seal.verified && call.seal.mode === "sui-mainnet" && call.seal.timestampMs < Date.parse(market.closesAt);
}

export function scoredFor(view: LedgerView, voiceId: string, includeSimulated: boolean): Scored[] {
  const rows: Scored[] = [];
  for (const call of view.calls) {
    if (call.voiceId !== voiceId) continue;
    const market = view.markets.get(call.marketId);
    const yes = view.resolved.get(call.marketId);
    if (!market || yes === undefined) continue;
    const timely = call.seal.timestampMs < Date.parse(market.closesAt);
    if (!timely) continue;
    if (!includeSimulated && !countsAsProof(call, market)) continue;
    rows.push({ p: call.p, yes, category: market.category });
  }
  return rows;
}

export function weights(view: LedgerView, includeSimulated: boolean): VoiceWeight[] {
  const categories = [...new Set([...view.markets.values()].map((m) => m.category))];
  return view.voiceIds.map((voiceId) => {
    const rows = scoredFor(view, voiceId, includeSimulated);
    const byCategory: Record<string, number> = {};
    for (const c of categories) byCategory[c] = weightFor(rows, c);
    return { voiceId, overall: weightFor(rows), byCategory, nResolved: rows.length };
  });
}

/** Credibility-weighted vs. naive average of each voice's latest call, for every unresolved market. */
export function consensus(view: LedgerView, includeSimulated: boolean): Consensus[] {
  const w = weights(view, includeSimulated);
  const out: Consensus[] = [];
  for (const market of view.markets.values()) {
    if (view.resolved.has(market.id)) continue;
    const latest = new Map<string, Call>();
    for (const call of view.calls) {
      if (call.marketId === market.id) latest.set(call.voiceId, call);
    }
    let num = 0;
    let den = 0;
    let sum = 0;
    for (const call of latest.values()) {
      const vw = w.find((x) => x.voiceId === call.voiceId);
      const weight = vw?.byCategory[market.category] ?? 1;
      num += weight * call.p;
      den += weight;
      sum += call.p;
    }
    if (latest.size === 0) continue;
    out.push({ marketId: market.id, weighted: num / den, naive: sum / latest.size, nCalls: latest.size });
  }
  return out;
}

export interface MemoryDiff {
  marketId: string;
  yes: boolean;
  voices: { voiceId: string; before: number; after: number; category: string }[];
  consensus: { marketId: string; before: number; after: number }[];
}

/** What changed in the app's beliefs because of one resolution. This is the "memory diff". */
export function diffForResolution(
  events: LedgerEvent[],
  marketId: string,
  yes: boolean,
  includeSimulated: boolean,
): MemoryDiff {
  const before = project(events);
  const afterEvents: LedgerEvent[] = [
    ...events,
    { t: "resolution", resolution: { marketId, yes, resolvedAt: new Date().toISOString() } },
  ];
  const after = project(afterEvents);
  const category = before.markets.get(marketId)?.category ?? "";
  const wb = weights(before, includeSimulated);
  const wa = weights(after, includeSimulated);
  const cb = consensus(before, includeSimulated);
  const ca = consensus(after, includeSimulated);
  return {
    marketId,
    yes,
    voices: wa.map((x) => ({
      voiceId: x.voiceId,
      category,
      before: wb.find((y) => y.voiceId === x.voiceId)?.byCategory[category] ?? 1,
      after: x.byCategory[category] ?? 1,
    })),
    consensus: ca
      .map((c) => ({
        marketId: c.marketId,
        before: cb.find((y) => y.marketId === c.marketId)?.weighted ?? c.weighted,
        after: c.weighted,
      }))
      .filter((c) => Math.abs(c.after - c.before) > 1e-9),
  };
}
