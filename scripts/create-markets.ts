// Creates the real Total Recall markets on the live ledger. Safe to re-run: skips questions that already exist.
import * as L from "../src/lib/ledger.ts";
const NS = L.FEATURED_NS;

const markets: [question: string, category: string, closesAt: string][] = [
  ["Democrats win control of the US Senate (AP call by Nov 9)?", "senate", "2026-11-03T11:00:00Z"],
  ["Democrat wins the Iowa Senate race (AP call by Nov 9)?", "senate", "2026-11-03T11:00:00Z"],
  ["Democrat wins the Texas Senate race (AP call by Nov 9)?", "senate", "2026-11-03T11:00:00Z"],
  ["Democrat wins the Ohio Senate race (AP call by Nov 9)?", "senate", "2026-11-03T11:00:00Z"],
  ["Democrats win the US House (AP call by Nov 9)?", "house", "2026-11-03T11:00:00Z"],
  ["Ravens beat Jaguars (Thu Nov 5)?", "nfl", "2026-11-06T00:00:00Z"],
  ["Bengals beat Falcons in Madrid (Sun Nov 8)?", "nfl", "2026-11-08T14:00:00Z"],
  ["Buccaneers beat Bears (Sun Nov 8, night game)?", "nfl", "2026-11-08T20:00:00Z"],
  ["Bills beat Vikings (Mon Nov 9)?", "nfl", "2026-11-10T00:00:00Z"],
];

const existing = new Set((await L.getState(NS)).markets.map((m) => m.question));
for (const [q, c, d] of markets) {
  if (existing.has(q)) {
    console.log("skip (exists):", q);
    continue;
  }
  const m = await L.addMarket(NS, q, c, d);
  console.log("created", m.id, "| closes", m.closesAt);
}
console.log("flushing to Walrus mainnet…");
await L.flush();
const s = await L.getState(NS);
console.log(JSON.stringify({ markets: s.markets.length, memoriesOnWalrus: s.memoriesWritten, pendingWrites: s.pendingWrites, lastWriteError: s.lastWriteError, memory: s.modes.memory, sui: s.modes.sui }));
