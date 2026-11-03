// One-off audit of the LIVE deployment against the systems underneath it. Read-only: no ledger writes.
import { MemWal } from "@mysten-incubation/memwal";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decode } from "../src/lib/memory.ts";

const LIVE = process.argv[2] ?? "https://callbook-jade.vercel.app";
const rows: [string, "PASS" | "FAIL" | "WARN", string][] = [];
const check = (name: string, ok: boolean, detail = "", warn = false) => rows.push([name, ok ? "PASS" : warn ? "WARN" : "FAIL", detail]);

const live = (await (await fetch(`${LIVE}/api/state`)).json()) as any;
check("live state loads", Array.isArray(live.markets), `${live.markets.length} questions, ${live.calls.length} predictions, ${live.memoriesWritten} memories`);
check("live modes are real", live.modes.memory === "walrus-mainnet" && live.modes.sui === "sui-mainnet", `${live.modes.memory} / ${live.modes.sui}`);
check("nothing stuck pending", live.pendingWrites === 0 && !live.lastWriteError, `pending ${live.pendingWrites}, error "${live.lastWriteError}"`);

// 1. Walrus read directly, compared with what the site shows
const mem = MemWal.create({ key: process.env.MEMWAL_PRIVATE_KEY!, accountId: process.env.MEMWAL_ACCOUNT_ID!, serverUrl: process.env.MEMWAL_SERVER_URL, namespace: process.env.MEMWAL_NAMESPACE ?? "callbook" });
const health = (await mem.health()) as any;
check("Walrus relayer healthy and write-ready", health.status === "ok" && health.write_ready === true, `status ${health.status}, write_ready ${health.write_ready}`);
const recall = await mem.recall({ query: "CALLBOOK/v1 ledger event", topK: 1000, maxDistance: 2 });
const evs = recall.results.map((r) => decode(r.text)).filter((e) => e !== null) as any[];
const by = (t: string) => evs.filter((e) => e.t === t).length;
check("Walrus holds every event the site shows", evs.length === live.memoriesWritten, `Walrus ${evs.length} vs site ${live.memoriesWritten}`);
check("Walrus market count matches site", by("market") === live.markets.length, `${by("market")} vs ${live.markets.length}`);
check("Walrus call count matches site", by("call") === live.calls.length, `${by("call")} vs ${live.calls.length}`);
check("no duplicate event ids in Walrus", new Set(evs.filter((e) => e.t === "call").map((e) => e.call.id)).size === by("call"));
check("meets the 10+ mainnet memories rule", recall.results.length >= 10, `${recall.results.length} memories in the namespace (${evs.length} ledger events)`);

// 2. Sui + Tatum: gas balance, gateway, and re-verify every sealed prediction
const sui = new SuiGraphQLClient({ network: "mainnet", url: process.env.TATUM_SUI_GRAPHQL_URL!, headers: { "x-api-key": process.env.TATUM_API_KEY! } });
const sealer = Ed25519Keypair.fromSecretKey(process.env.SEALER_PRIVATE_KEY!).toSuiAddress();
const bal = BigInt((await sui.core.getBalance({ owner: sealer })).balance.balance);
check("sealer wallet has gas", bal > 10_000_000n, `${Number(bal) / 1e9} SUI (about ${Math.floor(Number(bal) / 100_000)} more seals)`);
const byId = new Map(live.markets.map((m: any) => [m.id, m]));
for (const c of live.calls) {
  const v = (await (await fetch(`${LIVE}/api/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ callId: c.id }) })).json()) as any;
  const m: any = byId.get(c.marketId);
  const before = c.seal.timestampMs < Date.parse(m.closesAt);
  check(`prediction ${c.id.slice(-6)} re-verified on Sui via Tatum`, v.ok === true && c.seal.verified && c.seal.mode === "sui-mainnet" && before, `ok ${v.ok}, sealed before close ${before}`);
}

// 3. Secrets must not appear in the pages or scripts the site serves
const secrets = [process.env.MEMWAL_PRIVATE_KEY, process.env.SEALER_PRIVATE_KEY, process.env.TATUM_API_KEY, process.env.SESSION_SECRET].filter(Boolean) as string[];
let leaks = 0;
let scanned = 0;
for (const path of ["/", "/app", "/operator"]) {
  const html = await (await fetch(`${LIVE}${path}`)).text();
  const urls = [...html.matchAll(/\/_next\/static\/[^"')\s]+\.js/g)].map((m) => m[0]);
  for (const body of [html, ...(await Promise.all([...new Set(urls)].map((u) => fetch(`${LIVE}${u}`).then((r) => r.text()))))]) {
    scanned++;
    for (const s of secrets) if (body.includes(s.slice(0, 20))) leaks++;
  }
}
check("no secret appears in any served page or script", leaks === 0, `${scanned} files scanned, ${leaks} leaks`);

// 4. Privacy of the public API
const leakedOwner = JSON.stringify(live).match(/"owner":/g)?.length ?? 0;
check("public API does not expose wallet addresses", leakedOwner === 0, `${leakedOwner} "owner" fields in /api/state`, true);

// 5. Write protection
const w = await fetch(`${LIVE}/api/voices`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
check("operator writes refused without the token", w.status === 401, `HTTP ${w.status}`);
const wr = await fetch(`${LIVE}/api/resolve`, { method: "POST", headers: { "content-type": "application/json", "x-admin-token": "wrong" }, body: "{}" });
check("a wrong admin token is refused", wr.status === 401, `HTTP ${wr.status}`);
const pr = await fetch(`${LIVE}/api/predict`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ marketId: live.markets[0].id, p: 0.5 }) });
check("predicting without signing in is refused", pr.status === 401, `HTTP ${pr.status}`);
const fk = await fetch(`${LIVE}/api/predict`, { method: "POST", headers: { "content-type": "application/json", cookie: "cb_session=forged.token" }, body: JSON.stringify({ marketId: live.markets[0].id, p: 0.5 }) });
check("a forged session cookie is refused", fk.status === 401, `HTTP ${fk.status}`);
const hd = (await fetch(`${LIVE}/app`)).headers;
check("HTTPS is enforced (HSTS)", Boolean(hd.get("strict-transport-security")), hd.get("strict-transport-security") ?? "missing", true);
check("clickjacking protection header", Boolean(hd.get("x-frame-options") || (hd.get("content-security-policy") ?? "").includes("frame-ancestors")), "x-frame-options / frame-ancestors", true);

const w2 = Math.max(...rows.map((r) => r[0].length));
for (const [n, s, d] of rows) console.log(`${s.padEnd(4)}  ${n.padEnd(w2)}  ${d}`);
console.log(`\n${rows.filter((r) => r[1] === "PASS").length} pass, ${rows.filter((r) => r[1] === "WARN").length} warn, ${rows.filter((r) => r[1] === "FAIL").length} fail`);
