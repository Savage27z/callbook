import { MemWal, MemWalMock } from "@mysten-incubation/memwal";
import type { LedgerEvent } from "./types.ts";

const PREFIX = "CALLBOOK/v1 ";

export type MemoryMode = "walrus-mainnet" | "mock";

export interface LedgerMemory {
  mode: MemoryMode;
  /**
   * Store ledger events as Walrus memories in one bulk job (about the same wall-clock time as a
   * single write). Returns one blob id per event, in order, or null for an event that failed.
   */
  writeBatch(evs: LedgerEvent[]): Promise<(string | null)[]>;
  /** Recall every ledger event ever written to this namespace (fresh-session rebuild). */
  readAll(): Promise<{ events: LedgerEvent[]; blobIds: string[] }>;
}

export function memoryConfigured(): boolean {
  return Boolean(process.env.MEMWAL_PRIVATE_KEY && process.env.MEMWAL_ACCOUNT_ID);
}

export function encode(ev: LedgerEvent): string {
  return PREFIX + JSON.stringify(ev);
}

export function decode(text: string): LedgerEvent | null {
  const i = text.indexOf(PREFIX);
  if (i < 0) return null;
  try {
    return JSON.parse(text.slice(i + PREFIX.length)) as LedgerEvent;
  } catch {
    return null;
  }
}

const globalForMemory = globalThis as unknown as { __callbookMemories?: Map<string, LedgerMemory> };

/** The operator's public ledger. User ledgers get their own namespace, derived from their wallet. */
export const FEATURED_NS = process.env.MEMWAL_NAMESPACE ?? "callbook";

/** Drop a cached client. Only used to reset the in-memory mock between demo runs. */
export function resetMemory(namespace: string = FEATURED_NS): void {
  globalForMemory.__callbookMemories?.delete(namespace);
}

export function getMemory(namespace: string = FEATURED_NS): LedgerMemory {
  const registry = (globalForMemory.__callbookMemories ??= new Map());
  const cached = registry.get(namespace);
  if (cached) return cached;
  const live = memoryConfigured();
  const client = live
    ? MemWal.create({
        key: process.env.MEMWAL_PRIVATE_KEY!,
        accountId: process.env.MEMWAL_ACCOUNT_ID!,
        serverUrl: process.env.MEMWAL_SERVER_URL ?? "https://relayer.memory.walrus.xyz",
        namespace,
      })
    : MemWalMock.create({ namespace });

  const memory: LedgerMemory = {
    mode: live ? "walrus-mainnet" : "mock",
    async writeBatch(evs) {
      // The default bulk idempotency key is derived from the items, so retrying the same batch
      // after a timeout collapses onto the original job instead of paying twice.
      const res = await client.rememberBulkAndWait(
        evs.map((ev) => ({ text: encode(ev) })),
        { timeoutMs: 180_000 },
      );
      return res.results.map((r) => (r.status === "done" ? r.blob_id : null));
    },
    async readAll() {
      const res = await client.recall({ query: "CALLBOOK/v1 ledger event", topK: 1000, maxDistance: 2 });
      const found: { ev: LedgerEvent; blobId: string }[] = [];
      for (const hit of res.results) {
        const ev = decode(hit.text);
        if (ev) found.push({ ev, blobId: hit.blob_id });
      }
      found.sort((a, b) => (a.ev.at ?? Infinity) - (b.ev.at ?? Infinity));
      return { events: found.map((f) => f.ev), blobIds: found.map((f) => f.blobId) };
    },
  };
  registry.set(namespace, memory);
  return memory;
}
