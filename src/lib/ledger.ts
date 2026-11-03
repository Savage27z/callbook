import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createFileStore, createRedisStore, redisFromEnv, type Store } from "./store.ts";
import { FEATURED_NS, getMemory, memoryConfigured, resetMemory } from "./memory.ts";
import { consensus, diffForResolution, project, weights, type MemoryDiff } from "./scoring.ts";
import { commitmentFor, newNonce, readBack, sealCommitment, suiConfigured } from "./sui.ts";
import type { Call, LedgerEvent, Market, Voice, VoiceKind } from "./types.ts";

/**
 * Walrus Memory is the source of truth. A ledger is one Walrus namespace: the operator's featured
 * ledger, or one namespace per signed-in wallet. The JSON file per ledger is only a rebuildable
 * index so the UI is fast and so we can show a "wipe cache, rebuild from Walrus" demo.
 */
interface Cache {
  events: LedgerEvent[];
  /** Parallel to events. null = not yet stored on Walrus (queued or failed, will be retried). */
  blobIds: (string | null)[];
}

interface Ctx {
  ns: string;
  queue: Promise<unknown>;
  cacheLock: Promise<unknown>;
  flushing: Promise<void> | null;
  lastWriteError: string;
  lastAt: number;
  /** The empty-cache rebuild from Walrus has been attempted in this process. */
  bootstrapped: boolean;
}

export { FEATURED_NS };

/** Per-user caps protect the operator's SUI (seal gas) and Walrus account from strangers. */
export const limits = () => ({
  eventsPerUser: Number(process.env.USER_MAX_EVENTS ?? 40),
  users: Number(process.env.MAX_USERS ?? 60),
});

const NS_RE = /^[a-z0-9-]{1,64}$/;

// Shared across module reloads (Next dev can load route modules more than once).
const registry = ((globalThis as unknown as { __callbookCtx?: Map<string, Ctx> }).__callbookCtx ??= new Map());
function ctx(ns: string): Ctx {
  if (!NS_RE.test(ns)) throw new Error("Invalid ledger id");
  let c = registry.get(ns);
  if (!c) {
    c = { ns, queue: Promise.resolve(), cacheLock: Promise.resolve(), flushing: null, lastWriteError: "", lastAt: 0, bootstrapped: false };
    registry.set(ns, c);
  }
  return c;
}

const dir = () => path.resolve(process.env.CALLBOOK_DATA_DIR ?? "./data");
const fileOf = (key: string) => {
  const ns = key.replace(/^ledger:/, "");
  return ns === FEATURED_NS ? path.join(dir(), "ledger.json") : path.join(dir(), "ledgers", `${ns}.json`);
};

// The working copy lives in Redis when one is configured (serverless hosts), otherwise in a local file.
const storeRegistry = globalThis as unknown as { __callbookStore?: Store };
function getStore(): Store {
  if (!storeRegistry.__callbookStore) {
    const redis = redisFromEnv();
    storeRegistry.__callbookStore = redis ? createRedisStore(redis) : createFileStore(fileOf);
  }
  return storeRegistry.__callbookStore;
}

export const storeKind = () => getStore().kind;

async function load(ns: string): Promise<Cache> {
  return (await getStore().get<Cache>(`ledger:${ns}`)) ?? { events: [], blobIds: [] };
}

async function save(ns: string, cache: Cache): Promise<void> {
  await getStore().set(`ledger:${ns}`, cache);
}

/**
 * Run work after the HTTP response has been sent. On a serverless host the function would otherwise be
 * frozen the moment it replies, killing the slow Walrus write mid-flight; `after` keeps it alive.
 */
function background(work: Promise<unknown>): void {
  work.catch(() => undefined);
  if (!process.env.VERCEL) return; // a long-running server just lets the promise finish
  import("next/server").then((m) => m.after(work)).catch(() => undefined);
}

/** Number of user ledgers that exist on disk (used to cap sign-ups). */
export async function countUserLedgers(): Promise<number> {
  try {
    return (await readdir(path.join(dir(), "ledgers"))).filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

export async function ledgerExists(ns: string): Promise<boolean> {
  try {
    await readFile(fileOf(ns), "utf8");
    return true;
  } catch {
    return false;
  }
}

// Serialise writers so concurrent requests cannot interleave cache updates.
function exclusive<T>(c: Ctx, fn: () => Promise<T>): Promise<T> {
  const run = () => getStore().withLock(`op:${c.ns}`, 120_000, 90_000, fn);
  const next = c.queue.then(run, run);
  c.queue = next.catch(() => undefined);
  return next;
}

// Every read-modify-write of the cache file goes through this mutex, because the background
// flusher updates blob ids while user actions append events.
function mutate<T>(c: Ctx, fn: (cache: Cache) => T | Promise<T>): Promise<T> {
  const next = c.cacheLock.then(() =>
    getStore().withLock(`mutate:${c.ns}`, 20_000, 30_000, async () => {
      const cache = await load(c.ns);
      const out = await fn(cache);
      await save(c.ns, cache);
      return out;
    }),
  );
  c.cacheLock = next.catch(() => undefined);
  return next;
}

/** A read that waits for any in-flight cache write to finish. */
const snapshot = (c: Ctx) => c.cacheLock.then(() => load(c.ns));

const BATCH = 20;

/** Store every not-yet-stored event on Walrus, in batches. One flusher runs per ledger at a time. */
export function flush(ns: string = FEATURED_NS): Promise<void> {
  const c = ctx(ns);
  if (c.flushing) return c.flushing;
  c.flushing = (async () => {
    // Only one instance at a time pushes to Walrus; if another holds the lock it is already doing it.
    const release = await getStore().tryLock(`flush:${ns}`, 240_000);
    if (!release) {
      c.flushing = null;
      return;
    }
    try {
      for (;;) {
        const batch = await mutate(c, (cache) => {
          const idx: number[] = [];
          cache.blobIds.forEach((b, i) => b === null && idx.length < BATCH && idx.push(i));
          return idx.map((i) => ({ i, ev: cache.events[i] }));
        });
        if (batch.length === 0) return;
        let blobs: (string | null)[];
        try {
          blobs = await getMemory(ns).writeBatch(batch.map((b) => b.ev));
          c.lastWriteError = "";
        } catch (err) {
          c.lastWriteError = err instanceof Error ? err.message : String(err);
          return; // stays pending; retried on the next append or state poll
        }
        await mutate(c, (cache) => batch.forEach((b, k) => (cache.blobIds[b.i] = blobs[k] ?? null)));
        if (blobs.every((b) => b === null)) return; // nothing stored, avoid a hot retry loop
      }
    } finally {
      c.flushing = null;
      await release().catch(() => undefined);
    }
  })();
  return c.flushing;
}

/** Record an event locally right away and queue it for Walrus; callers never wait on storage. */
async function append(c: Ctx, ev: LedgerEvent): Promise<void> {
  await mutate(c, (cache) => {
    if (c.ns !== FEATURED_NS && cache.events.length >= limits().eventsPerUser) {
      throw new Error(`Your ledger is full (${limits().eventsPerUser} entries). This demo caps each wallet to protect the operator's funds.`);
    }
    const last = cache.events.reduce((m, e) => Math.max(m, e.at ?? 0), c.lastAt);
    c.lastAt = Math.max(Date.now(), last + 1);
    cache.events.push({ ...ev, at: c.lastAt });
    cache.blobIds.push(null);
  });
  background(flush(c.ns));
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const uid = () => Math.random().toString(36).slice(2, 8);

export function addVoice(ns: string, name: string, kind: VoiceKind): Promise<Voice> {
  const c = ctx(ns);
  return exclusive(c, async () => {
    const cache = await snapshot(c);
    const id = slug(name);
    if (!id) throw new Error("A forecaster needs a name");
    if (cache.events.some((e) => e.t === "voice" && e.voice.id === id)) throw new Error("That forecaster already exists");
    const voice: Voice = { id, name: name.trim(), kind };
    await append(c, { t: "voice", voice });
    return voice;
  });
}

export function addMarket(ns: string, question: string, category: string, closesAt: string): Promise<Market> {
  const c = ctx(ns);
  return exclusive(c, async () => {
    if (!question.trim()) throw new Error("A question is required");
    if (Number.isNaN(Date.parse(closesAt))) throw new Error("closesAt must be an ISO date");
    const market: Market = { id: `${slug(question)}-${uid()}`, question: question.trim(), category: slug(category) || "general", closesAt };
    await append(c, { t: "market", market });
    return market;
  });
}

async function makeCallIn(c: Ctx, ns: string, marketId: string, voiceId: string, p: number, owner?: string): Promise<Call> {
  if (!(p > 0 && p < 1)) throw new Error("p must be strictly between 0 and 1");
  const cache = await snapshot(c);
  const market = cache.events.find((e) => e.t === "market" && e.market.id === marketId);
  if (!market) throw new Error("Unknown question");
  if (!cache.events.some((e) => e.t === "voice" && e.voice.id === voiceId)) throw new Error("Unknown forecaster");
  if (project(cache.events).resolved.has(marketId)) throw new Error("That question already has a result");
  if (ns !== FEATURED_NS && cache.events.length >= limits().eventsPerUser) {
    throw new Error(`Your ledger is full (${limits().eventsPerUser} entries). This demo caps each wallet to protect the operator's funds.`);
  }
  const base = { marketId, voiceId, p, nonce: newNonce(), ...(owner ? { owner } : {}) };
  const commitment = commitmentFor(base);
  const seal = await sealCommitment(commitment);
  const closes = Date.parse((market as { market: Market }).market.closesAt);
  if (seal.timestampMs >= closes) throw new Error("This question is already closed; predictions cannot be backdated");
  const call: Call = { id: `call-${uid()}`, ...base, commitment, seal };
  await append(c, { t: "call", call });
  return call;
}

export function makeCall(ns: string, marketId: string, voiceId: string, p: number, owner?: string): Promise<Call> {
  const c = ctx(ns);
  return exclusive(c, () => makeCallIn(c, ns, marketId, voiceId, p, owner));
}

/**
 * A signed-in user makes their own prediction. Their forecaster profile is created on first use, and each
 * user can predict a question only once: a locked-in prediction is final, so nobody can edit their record.
 */
export function predict(ns: string, owner: string, voiceId: string, name: string, marketId: string, p: number): Promise<Call> {
  const c = ctx(ns);
  return exclusive(c, async () => {
    const cache = await snapshot(c);
    const market = cache.events.find((e) => e.t === "market" && e.market.id === marketId);
    if (!market || market.t !== "market") throw new Error("Unknown question");
    if (project(cache.events).resolved.has(marketId)) throw new Error("That question already has a result");
    if (Date.now() >= Date.parse(market.market.closesAt)) throw new Error("This question is closed");
    if (cache.events.some((e) => e.t === "call" && e.call.marketId === marketId && e.call.voiceId === voiceId)) {
      throw new Error("You already locked in a prediction on this question. Predictions are final.");
    }
    if (!cache.events.some((e) => e.t === "voice" && e.voice.id === voiceId)) {
      const users = cache.events.filter((e) => e.t === "voice" && e.voice.kind === "user").length;
      if (users >= limits().users) throw new Error("This demo has reached its limit of players.");
      await append(c, { t: "voice", voice: { id: voiceId, name, kind: "user", owner } });
    }
    return makeCallIn(c, ns, marketId, voiceId, p, owner);
  });
}

export function resolveMarket(ns: string, marketId: string, yes: boolean): Promise<MemoryDiff> {
  const c = ctx(ns);
  return exclusive(c, async () => {
    const cache = await snapshot(c);
    const market = cache.events.find((e) => e.t === "market" && e.market.id === marketId);
    if (!market) throw new Error("Unknown question");
    if (project(cache.events).resolved.has(marketId)) throw new Error("Already has a result");
    // A real (mainnet) result is permanent, so it cannot be entered before the question has closed.
    if (getMemory(ns).mode === "walrus-mainnet" && market.t === "market" && Date.now() < Date.parse(market.market.closesAt)) {
      throw new Error("This question has not closed yet. Enter the result after its close time.");
    }
    const includeSim = !suiConfigured();
    const diff = diffForResolution(cache.events, marketId, yes, includeSim);
    await append(c, { t: "resolution", resolution: { marketId, yes, resolvedAt: new Date().toISOString() } });
    return diff;
  });
}

/** Cancel a market's current resolution (append-only: a void event is recorded, nothing is deleted). */
export function voidResolution(ns: string, marketId: string, reason: string): Promise<void> {
  const c = ctx(ns);
  return exclusive(c, async () => {
    const cache = await snapshot(c);
    if (!project(cache.events).resolved.has(marketId)) throw new Error("That question has no result to undo");
    await append(c, { t: "void", marketId, reason: reason.trim() || "voided by owner" });
  });
}

export function reverify(ns: string, callId: string) {
  const c = ctx(ns);
  return exclusive(c, async () => {
    const cache = await snapshot(c);
    const ev = cache.events.find((e) => e.t === "call" && e.call.id === callId);
    if (!ev || ev.t !== "call") throw new Error("Unknown prediction");
    if (!ev.call.seal.digest) throw new Error("This prediction has no Sui digest (simulated seal)");
    return readBack(ev.call.seal.digest, ev.call.commitment);
  });
}

function requireDemoMode(ns: string): void {
  if (getMemory(ns).mode !== "mock") {
    throw new Error("Demo data is disabled while connected to Walrus mainnet, so fake records never reach real memory.");
  }
}

export function resetDemo(ns: string): Promise<void> {
  const c = ctx(ns);
  return exclusive(c, async () => {
    requireDemoMode(ns);
    resetMemory(ns);
    await mutate(c, (cache) => {
      cache.events = [];
      cache.blobIds = [];
    });
  });
}

/** A small scripted history so the learning loop is visible without typing anything. Mock memory only. */
export async function loadDemo(ns: string): Promise<void> {
  requireDemoMode(ns);
  if ((await snapshot(ctx(ns))).events.length > 0) throw new Error("Reset first: the ledger already has data");
  const closes = new Date(Date.now() + 24 * 3600_000).toISOString();
  await addVoice(ns, "Sam (sharp friend)", "friend");
  await addVoice(ns, "Harry (hot takes)", "pundit");
  await addVoice(ns, "Model-7", "model");

  const past: [string, string, boolean, Record<string, number>][] = [
    ["Chiefs beat Bills", "nfl", true, { "sam-sharp-friend": 0.72, "harry-hot-takes": 0.95, "model-7": 0.6 }],
    ["Packers beat Bears", "nfl", true, { "sam-sharp-friend": 0.8, "harry-hot-takes": 0.3, "model-7": 0.65 }],
    ["Cowboys cover -6.5", "nfl", false, { "sam-sharp-friend": 0.35, "harry-hot-takes": 0.9, "model-7": 0.5 }],
    ["Incumbent holds Senate seat", "politics", true, { "sam-sharp-friend": 0.55, "harry-hot-takes": 0.2, "model-7": 0.85 }],
    ["Turnout above 2022", "politics", true, { "sam-sharp-friend": 0.5, "harry-hot-takes": 0.1, "model-7": 0.8 }],
  ];
  for (const [question, category, yes, calls] of past) {
    const m = await addMarket(ns, question, category, closes);
    for (const [voiceId, p] of Object.entries(calls)) await makeCall(ns, m.id, voiceId, p);
    await resolveMarket(ns, m.id, yes);
  }

  const open: [string, string, Record<string, number>][] = [
    ["Eagles beat Commanders", "nfl", { "sam-sharp-friend": 0.7, "harry-hot-takes": 0.15, "model-7": 0.55 }],
    ["Ballot measure 4 passes", "politics", { "sam-sharp-friend": 0.4, "harry-hot-takes": 0.9, "model-7": 0.75 }],
  ];
  for (const [question, category, calls] of open) {
    const m = await addMarket(ns, question, category, closes);
    for (const [voiceId, p] of Object.entries(calls)) await makeCall(ns, m.id, voiceId, p);
  }
}

/** Throw the local cache away and rebuild the ledger purely from Walrus Memory. */
export function rebuildFromMemory(ns: string) {
  const c = ctx(ns);
  return exclusive(c, async () => {
    await flush(ns);
    const before = await snapshot(c);
    const pending = before.blobIds.filter((b) => b === null).length;
    if (pending > 0) throw new Error(`${pending} event(s) are not on Walrus yet; rebuilding now would lose them. ${c.lastWriteError}`.trim());
    const includeSim = !suiConfigured();
    const wBefore = JSON.stringify(weights(project(before.events), includeSim));
    const { events, blobIds } = await getMemory(ns).readAll();
    await mutate(c, (cache) => {
      cache.events = events;
      cache.blobIds = blobIds;
    });
    const wAfter = JSON.stringify(weights(project(events), includeSim));
    return { recalled: events.length, matchesBefore: wBefore === wAfter, before: before.events.length };
  });
}

export async function getState(ns: string, viewerVoiceId?: string) {
  const c = ctx(ns);
  // A fresh deployment (or a wiped disk) starts with an empty cache. Walrus is the source of truth, so
  // rebuild from it once per process instead of showing an empty ledger.
  if (!c.bootstrapped) {
    c.bootstrapped = true;
    if ((await snapshot(c)).events.length === 0 && getMemory(ns).mode === "walrus-mainnet") {
      try {
        await rebuildFromMemory(ns);
      } catch {
        // Not fatal: the operator can still press "Rebuild from Walrus".
      }
    }
  }
  const cache = await snapshot(c);
  const includeSim = !suiConfigured();
  const view = project(cache.events);
  const voices = cache.events.flatMap((e) => (e.t === "voice" ? [e.voice] : []));
  const pendingWrites = cache.blobIds.filter((b) => b === null).length;
  if (pendingWrites > 0) background(flush(ns)); // self-heal after a restart or a failed batch
  const callStored: Record<string, boolean> = {};
  cache.events.forEach((e, i) => {
    if (e.t === "call") callStored[e.call.id] = cache.blobIds[i] !== null;
  });
  // Overall weight of every voice right after each resolution, in order: the learning curve.
  const history: { marketId: string; question: string; yes: boolean; weights: Record<string, number> }[] = [];
  const replay: LedgerEvent[] = [];
  for (const e of cache.events) {
    replay.push(e);
    if (e.t !== "resolution") continue;
    const w = weights(project(replay), includeSim);
    history.push({
      marketId: e.resolution.marketId,
      question: view.markets.get(e.resolution.marketId)?.question ?? "",
      yes: e.resolution.yes,
      weights: Object.fromEntries(w.map((x) => [x.voiceId, x.overall])),
    });
  }
  return {
    modes: {
      memory: getMemory(ns).mode,
      sui: suiConfigured() ? "sui-mainnet" : "simulated",
      memoryConfigured: memoryConfigured(),
      canDemo: getMemory(ns).mode === "mock",
    },
    memoriesWritten: cache.blobIds.length - pendingWrites,
    pendingWrites,
    lastWriteError: c.lastWriteError,
    callStored,
    voices,
    weights: weights(view, includeSim),
    markets: [...view.markets.values()],
    // While a question is open, other players' predictions stay private (no herding); experts' stay public.
    calls: view.calls.filter((call) => {
      if (view.resolved.has(call.marketId)) return true;
      if (call.voiceId === viewerVoiceId) return true;
      const v = voices.find((x) => x.id === call.voiceId);
      return v?.kind !== "user";
    }),
    resolved: Object.fromEntries(view.resolved),
    consensus: consensus(view, includeSim),
    history,
    quota: ns === FEATURED_NS ? null : { used: cache.events.length, max: limits().eventsPerUser },
  };
}
