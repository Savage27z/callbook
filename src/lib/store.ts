import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Redis } from "@upstash/redis";

/**
 * Where the ledger's working copy lives. Walrus Memory is the source of truth; this is the fast, shared
 * index in front of it. Locally (and on a long-running host) it is a JSON file. On a serverless host,
 * where every request can run on a different short-lived instance, it is a Redis database, with locks
 * that work across instances so two requests can never interleave a read-modify-write.
 */
export interface Store {
  kind: "file" | "redis";
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  /** Try to take a named lock without waiting. Returns a release function, or null if someone holds it. */
  tryLock(name: string, ttlMs: number): Promise<(() => Promise<void>) | null>;
  /** Run `fn` while holding the named lock, waiting up to `waitMs` to get it. */
  withLock<T>(name: string, ttlMs: number, waitMs: number, fn: () => Promise<T>): Promise<T>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withLockVia<T>(store: Store, name: string, ttlMs: number, waitMs: number, fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + waitMs;
  for (let attempt = 0; ; attempt++) {
    const release = await store.tryLock(name, ttlMs);
    if (release) {
      try {
        return await fn();
      } finally {
        await release().catch(() => undefined);
      }
    }
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for the "${name}" lock. Try again in a moment.`);
    await sleep(Math.min(60 + attempt * 40, 400));
  }
}

/** JSON files on disk, with in-process locks. Fine for one long-running process. */
export function createFileStore(fileOf: (key: string) => string): Store {
  const held = new Set<string>();
  const store: Store = {
    kind: "file",
    async get<T>(key: string) {
      try {
        return JSON.parse(await readFile(fileOf(key), "utf8")) as T;
      } catch {
        return null;
      }
    },
    async set(key, value) {
      const file = fileOf(key);
      await mkdir(path.dirname(file), { recursive: true });
      // Write-then-rename so a concurrent reader never sees a half-written file.
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(value, null, 2));
      await rename(tmp, file);
    },
    async tryLock(name) {
      if (held.has(name)) return null;
      held.add(name);
      return async () => {
        held.delete(name);
      };
    },
    withLock: (name, ttlMs, waitMs, fn) => withLockVia(store, name, ttlMs, waitMs, fn),
  };
  return store;
}

/** The slice of the Upstash client this store uses (small so it can be faked in tests). */
export interface RedisLike {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { nx?: boolean; px?: number }): Promise<unknown>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}

const UNLOCK = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export function createRedisStore(client: RedisLike): Store {
  const store: Store = {
    kind: "redis",
    get: (key) => client.get(key),
    async set(key, value) {
      await client.set(key, value);
    },
    async tryLock(name, ttlMs) {
      const token = randomBytes(12).toString("hex");
      const key = `lock:${name}`;
      const ok = await client.set(key, token, { nx: true, px: ttlMs });
      if (!ok) return null;
      // Only the holder can release: if the lock expired and someone else took it, this is a no-op.
      return async () => {
        await client.eval(UNLOCK, [key], [token]);
      };
    },
    withLock: (name, ttlMs, waitMs, fn) => withLockVia(store, name, ttlMs, waitMs, fn),
  };
  return store;
}

export function redisFromEnv(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? new Redis({ url, token }) : null;
}
