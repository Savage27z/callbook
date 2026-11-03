import assert from "node:assert/strict";
import { test } from "node:test";
import { createRedisStore, type RedisLike } from "../src/lib/store.ts";

/** In-memory stand-in for the slice of Redis the store uses: values, SET NX PX, and the unlock script. */
export function fakeRedis(): RedisLike {
  const data = new Map<string, { v: unknown; exp: number }>();
  const live = (k: string) => {
    const e = data.get(k);
    if (e && e.exp && e.exp < Date.now()) data.delete(k);
    return data.get(k);
  };
  return {
    async get<T>(key: string) {
      const e = live(key);
      return e ? (JSON.parse(JSON.stringify(e.v)) as T) : null;
    },
    async set(key, value, opts) {
      if (opts?.nx && live(key)) return null;
      data.set(key, { v: JSON.parse(JSON.stringify(value)), exp: opts?.px ? Date.now() + opts.px : 0 });
      return "OK";
    },
    async eval(_script, keys, args) {
      const e = live(keys[0]);
      if (e && e.v === args[0]) {
        data.delete(keys[0]);
        return 1;
      }
      return 0;
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("values round-trip through the redis store", async () => {
  const s = createRedisStore(fakeRedis());
  assert.equal(await s.get("nope"), null);
  await s.set("ledger:x", { events: [{ t: "voice" }], blobIds: [null, "abc"] });
  assert.deepEqual(await s.get("ledger:x"), { events: [{ t: "voice" }], blobIds: [null, "abc"] });
});

test("a held lock cannot be taken, and can be taken again after release", async () => {
  const s = createRedisStore(fakeRedis());
  const release = await s.tryLock("a", 5_000);
  assert.ok(release);
  assert.equal(await s.tryLock("a", 5_000), null);
  await release!();
  assert.ok(await s.tryLock("a", 5_000));
});

test("a stale holder cannot release a lock someone else now owns", async () => {
  const s = createRedisStore(fakeRedis());
  const oldRelease = await s.tryLock("b", 30);
  await sleep(60); // the first lock expires
  const newRelease = await s.tryLock("b", 5_000);
  assert.ok(newRelease);
  await oldRelease!(); // must not free the new holder's lock
  assert.equal(await s.tryLock("b", 5_000), null, "the new holder still has it");
});

test("withLock serialises concurrent work", async () => {
  const s = createRedisStore(fakeRedis());
  let running = 0;
  let peak = 0;
  let total = 0;
  await Promise.all(
    Array.from({ length: 6 }, () =>
      s.withLock("c", 5_000, 5_000, async () => {
        running++;
        peak = Math.max(peak, running);
        await sleep(15);
        total++;
        running--;
      }),
    ),
  );
  assert.equal(total, 6);
  assert.equal(peak, 1, "never more than one holder at a time");
});

test("withLock gives up with a clear error when it cannot get the lock", async () => {
  const s = createRedisStore(fakeRedis());
  await s.tryLock("d", 5_000);
  await assert.rejects(s.withLock("d", 5_000, 120, async () => 1), /Timed out waiting/);
});
