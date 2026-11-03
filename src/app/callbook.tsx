"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MemoryDiff } from "@/lib/scoring.ts";
import type { Call, Consensus, Market, Voice, VoiceWeight } from "@/lib/types.ts";
import { colorFor, ConsensusTrack, Sparkline, WeightChart, type CallDot } from "./charts.tsx";
import { listSuiWallets, onWalletsChange, signInWithWallet, signOut } from "./wallet.ts";
import type { Wallet } from "@mysten/wallet-standard";
import "./dashboard.css";

interface State {
  modes: { memory: string; sui: string; memoryConfigured: boolean; canDemo: boolean };
  memoriesWritten: number;
  pendingWrites: number;
  lastWriteError: string;
  callStored: Record<string, boolean>;
  voices: Voice[];
  weights: VoiceWeight[];
  markets: Market[];
  calls: Call[];
  resolved: Record<string, boolean>;
  consensus: Consensus[];
  history: { marketId: string; question: string; yes: boolean; weights: Record<string, number> }[];
  admin: boolean;
  adminRequired: boolean;
  scope: "featured" | "me";
  address: string | null;
  quota: { used: number; max: number } | null;
}

type Scope = "featured" | "me";
// Which ledger API calls are about. Module-level so api() always agrees with the current tab.
let ledgerScope: Scope = "featured";
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const TOKEN_KEY = "callbook-admin-token";
const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
};

async function api<T>(url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "x-admin-token": getToken(), "x-ledger": ledgerScope };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(url, body === undefined ? { headers } : { method: "POST", headers, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Request failed");
  return json as T;
}

const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const LOGO = (
  <svg viewBox="0 0 80 80" aria-hidden="true">
    <circle cx="40" cy="40" r="35" fill="none" stroke="currentColor" strokeWidth="6" />
    <path d="M26 42 36 53 55 28" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function CallBook() {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [diff, setDiff] = useState<MemoryDiff | null>(null);
  const [note, setNote] = useState("");
  const [showMarketForm, setShowMarketForm] = useState(false);
  const [scope, setScope] = useState<Scope>("featured");
  const [address, setAddress] = useState<string | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [booted, setBooted] = useState(false);

  // On load: restore the wallet session (cookie) and the last-used tab.
  useEffect(() => {
    (async () => {
      try {
        const me = await api<{ address: string | null }>("/api/auth/me");
        setAddress(me.address);
      } catch {}
      setBooted(true);
    })();
  }, []);

  const refresh = useCallback(async () => {
    ledgerScope = scope;
    setState(await api<State>("/api/state"));
  }, [scope]);
  useEffect(() => {
    if (!booted) return;
    if (scope === "me" && !address) return;
    refresh().catch((e) => setError(String(e.message ?? e)));
  }, [booted, scope, address, refresh]);

  function switchScope(next: Scope) {
    try {
      localStorage.setItem("callbook-scope", next);
    } catch {}
    ledgerScope = next;
    setState(null);
    setDiff(null);
    setError("");
    setScope(next);
  }

  // While events are still being stored on Walrus, keep polling so the badges flip to "stored".
  const pending = state?.pendingWrites ?? 0;
  useEffect(() => {
    if (pending === 0) return;
    const t = setInterval(() => refresh().catch(() => undefined), 3000);
    return () => clearInterval(t);
  }, [pending, refresh]);

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError("");
    try {
      const out = await fn();
      await refresh();
      return out;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const derived = useMemo(() => {
    if (!state) return null;
    const index = new Map(state.voices.map((v, i) => [v.id, i]));
    const byVoice = new Map(state.weights.map((w) => [w.voiceId, w]));
    const cons = new Map(state.consensus.map((c) => [c.marketId, c]));
    const open = state.markets.filter((m) => !(m.id in state.resolved)).sort((a, b) => Date.parse(a.closesAt) - Date.parse(b.closesAt));
    const done = state.markets.filter((m) => m.id in state.resolved).reverse();
    const board = [...state.voices].sort((a, b) => (byVoice.get(b.id)?.overall ?? 1) - (byVoice.get(a.id)?.overall ?? 1));
    return { index, byVoice, cons, open, done, board };
  }, [state]);

  if (scope === "me" && !address && booted) {
    return (
      <div className="cb">
        <nav className="cb-nav">
          <a className="brand" href="/" aria-label="CallBook home">
            {LOGO}
            callbook
          </a>
          <a className="btn" href="/">
            Back to site
          </a>
        </nav>
        <section className="gate">
          <span className="pill">Your own ledger</span>
          <h1>Sign in with your Sui wallet</h1>
          <p>
            Connect a wallet to keep your own forecasters, questions and predictions. Signing in is free: you sign one message to prove the wallet is yours, and no transaction is sent. Your ledger is separate from everyone
            else&apos;s.
          </p>
          <div className="gate-actions">
            <button className="btn" onClick={() => setWalletOpen(true)}>
              Connect wallet
            </button>
            <button className="btn ghost" onClick={() => switchScope("featured")}>
              View the featured ledger instead
            </button>
          </div>
          <p className="gate-note">The demo hosts your records for you (in a Walrus namespace tied to your wallet) and caps each wallet at a small number of entries.</p>
        </section>
        {walletOpen && (
          <WalletModal
            onClose={() => setWalletOpen(false)}
            onDone={(a) => {
              setAddress(a);
              setWalletOpen(false);
              switchScope("me");
            }}
          />
        )}
      </div>
    );
  }

  if (!state || !derived) {
    return (
      <div className="cb">
        <div className="cb-loading">{error ? <p className="toast-inline">{error}</p> : "Loading your ledger…"}</div>
      </div>
    );
  }

  const { index, byVoice, cons, open, done, board } = derived;
  const voiceName = (id: string) => state.voices.find((v) => v.id === id)?.name ?? id;
  const colorOf = (id: string) => colorFor(index.get(id) ?? 0);
  const live = state.modes.memory === "walrus-mainnet" && state.modes.sui === "sui-mainnet";
  const stats = [
    { label: "Predictions locked in", value: state.calls.length },
    { label: "Forecasters scored", value: state.weights.filter((w) => w.nResolved > 0).length },
    { label: "Questions answered", value: Object.keys(state.resolved).length },
    { label: "Records saved on Walrus", value: state.memoriesWritten },
  ];
  const empty = state.voices.length === 0 && state.markets.length === 0;
  const canWrite = state.admin;

  return (
    <div className="cb">
      <nav className="cb-nav">
        <a className="brand" href="/" aria-label="CallBook home">
          {LOGO}
          callbook
        </a>
        <a className="btn" href="/">
          Back to site
        </a>
      </nav>

      <header className="banner">
        <div className="banner-bg" aria-hidden />
        <div className="banner-in">
          <span className="pill">Operator console</span>
          <h1>Who has earned your trust?</h1>
          <p className="lede">Add the forecasters you follow, lock in their predictions before an event, and enter the result afterwards. CallBook scores who was right, so you know whose predictions to trust next time.</p>
          <div className="tickets">
            {stats.map((s) => (
              <div className="ticket" key={s.label}>
                <small>{s.label}</small>
                <b>{s.value}</b>
              </div>
            ))}
          </div>
          <div className="chips">
            <span className={`chip ${state.modes.memory === "walrus-mainnet" ? "ok" : "warn"}`}>
              <i /> Storage · {state.modes.memory === "walrus-mainnet" ? "Walrus mainnet" : "practice (not saved)"}
            </span>
            <span className={`chip ${state.modes.sui === "sui-mainnet" ? "ok" : "warn"}`}>
              <i /> Proof · {state.modes.sui === "sui-mainnet" ? "Sui, checked via Tatum" : "simulated, not real proof"}
            </span>
            {state.pendingWrites > 0 && (
              <span className="chip busy">
                <i /> {state.pendingWrites} storing on Walrus (~25s)
                {state.lastWriteError ? " · retrying" : ""}
              </span>
            )}
            {!live && <span className="chip muted">Demo mode: add keys in .env to go live</span>}
            <span className="grow" />
            <AdminBar
              admin={state.admin}
              required={state.adminRequired}
              onChange={() => {
                setNote("");
                refresh().catch(() => undefined);
              }}
            />
            {canWrite && state.modes.canDemo && (
              <>
                <button className="btn" disabled={busy || !empty} onClick={() => run(() => api("/api/demo", { action: "load" }))}>
                  Load demo
                </button>
                <button className="btn ghost" disabled={busy || empty} onClick={() => run(() => api("/api/demo", { action: "reset" }))}>
                  Reset
                </button>
              </>
            )}
            {canWrite && (
            <button
              className="btn ghost"
              disabled={busy}
              title="Throw the local cache away and rebuild the whole ledger from Walrus Memory"
              onClick={async () => {
                const r = await run(() => api<{ recalled: number; matchesBefore: boolean }>("/api/rebuild", {}));
                if (r) setNote(`Rebuilt ${r.recalled} events from Walrus. Weights ${r.matchesBefore ? "match" : "DIFFER from"} the cache.`);
              }}
            >
              Rebuild from Walrus
            </button>
            )}
          </div>
          {note && <p className="note">{note}</p>}
        </div>
      </header>

      <Guide state={state} canWrite={canWrite} />

      {diff && (
        <section className="diff-card" aria-live="polite">
          <div className="diff-head">
            <div>
              <span className="pill">What changed</span>
              <h2>How trust moved after that result</h2>
            </div>
            <button className="x" onClick={() => setDiff(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
          <div className="diff-grid">
            {diff.voices.map((v) => {
              const d = v.after - v.before;
              return (
                <div className="diff-row" key={v.voiceId}>
                  <i style={{ background: colorOf(v.voiceId) }} />
                  <span className="who">
                    {voiceName(v.voiceId)} <em>{v.category}</em>
                  </span>
                  <span className="nums">
                    {v.before.toFixed(2)} → <b>{v.after.toFixed(2)}</b>
                  </span>
                  <span className={`delta ${d > 0.005 ? "up" : d < -0.005 ? "down" : ""}`}>{d > 0.005 ? "▲" : d < -0.005 ? "▼" : "•"} {Math.abs(d).toFixed(2)}</span>
                </div>
              );
            })}
            {diff.consensus.map((c) => (
              <div className="diff-row cons" key={c.marketId}>
                <i className="ring" />
                <span className="who">{state.markets.find((m) => m.id === c.marketId)?.question}</span>
                <span className="nums">
                  {pct(c.before, 1)} → <b>{pct(c.after, 1)}</b>
                </span>
                <span className="delta">trusted answer</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {empty ? (
        <section className="onboard" id="ledger">
          <h2>Start in three steps</h2>
          <ol>
            <li>
              <span>1</span>
              <div>
                <h3>Add forecasters</h3>
                <p>Anyone who makes predictions: a friend, a forecasting site, a pundit, an AI model, or you.</p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <h3>Ask a question</h3>
                <p>A yes/no question about the future, with a deadline, like “Will the Chiefs beat the Bills?”.</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <h3>Lock in predictions, then enter the result</h3>
                <p>Each prediction is locked in on Sui before the event, so nobody can change it afterwards. Once the result is in, each forecaster gets scored.</p>
              </div>
            </li>
          </ol>
          {canWrite ? (
            <AddVoice busy={busy} onAdd={(name, kind) => run(() => api("/api/voices", { name, kind }))} />
          ) : (
            <p className="insight">This is a read-only view. The operator adds forecasters, questions and predictions.</p>
          )}
        </section>
      ) : (
        <main className="layout" id="ledger">
          <div className="col-main">
            <div className="section-head">
              <h2>Open questions</h2>
              {canWrite && (
                <button className="btn" onClick={() => setShowMarketForm((v) => !v)}>
                  {showMarketForm ? "Close" : "New question"}
                </button>
              )}
            </div>
            {canWrite && showMarketForm && (
              <div className="card">
                <AddMarket
                  busy={busy}
                  onAdd={async (q, c, d) => {
                    const m = await run(() => api("/api/markets", { question: q, category: c, closesAt: d }));
                    if (m) setShowMarketForm(false);
                  }}
                />
              </div>
            )}
            {open.length === 0 && <p className="empty">No open questions. Add one to start collecting predictions.</p>}
            {open.map((m) => {
              const calls = state.calls.filter((c) => c.marketId === m.id);
              const c = cons.get(m.id);
              const dots: CallDot[] = calls.map((x) => ({
                voice: voiceName(x.voiceId),
                color: colorOf(x.voiceId),
                p: x.p,
                weight: byVoice.get(x.voiceId)?.byCategory[m.category] ?? 1,
              }));
              return (
                <article className="card market" key={m.id}>
                  <div className="market-top">
                    <h3>{m.question}</h3>
                    <div className="pills">
                      <span className="pill">{m.category}</span>
                      <span className="pill soft">closes {when(m.closesAt)}</span>
                    </div>
                  </div>
                  <ConsensusTrack dots={dots} weighted={c ? c.weighted : null} naive={c ? c.naive : null} />
                  <p className="caption">Each dot is one forecaster&apos;s prediction. A bigger dot means a better track record.</p>
                  {c && Math.abs(c.weighted - c.naive) >= 0.005 && (
                    <p className="insight">
                      Because some forecasters have a better record, the trust-weighted answer is <b>{Math.abs((c.weighted - c.naive) * 100).toFixed(1)} points {c.weighted > c.naive ? "higher" : "lower"}</b> than the simple average.
                    </p>
                  )}
                  <CallList calls={calls} state={state} voiceName={voiceName} colorOf={colorOf} />
                  {canWrite && (
                  <MakeCall busy={busy} voices={state.voices} onCall={(v, p) => run(() => api("/api/calls", { marketId: m.id, voiceId: v, p }))} />
                  )}
                  {canWrite && (
                  <div className="resolve">
                    <span>Result known?</span>
                    {([true, false] as const).map((yes) => (
                      <button
                        key={String(yes)}
                        className="btn ghost"
                        disabled={busy}
                        onClick={async () => {
                          if (!window.confirm(`Enter the result of "${m.question}" as ${yes ? "YES" : "NO"}?

It is saved permanently to Walrus (it can be undone, but the history stays).`)) return;
                          const d = await run(() => api<MemoryDiff>("/api/resolve", { marketId: m.id, yes }));
                          if (d) {
                            setDiff(d);
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }
                        }}
                      >
                        Result: {yes ? "YES" : "NO"}
                      </button>
                    ))}
                  </div>
                  )}
                </article>
              );
            })}

            {done.length > 0 && (
              <>
                <div className="section-head">
                  <h2>Answered</h2>
                  <span className="count">{done.length}</span>
                </div>
                {done.map((m) => {
                  const yes = state.resolved[m.id];
                  const calls = state.calls.filter((c) => c.marketId === m.id);
                  return (
                    <article className="card market resolved" key={m.id}>
                      <div className="market-top">
                        <h3>{m.question}</h3>
                        <div className="pills">
                          <span className="pill">{m.category}</span>
                          <span className={`pill outcome ${yes ? "yes" : "no"}`}>Result: {yes ? "YES" : "NO"}</span>
                          {canWrite && (
                            <button
                              className="btn ghost"
                              disabled={busy}
                              title="Cancel this resolution (recorded as a void event; nothing is deleted)"
                              onClick={() => {
                                if (!window.confirm(`Void the result of "${m.question}"?

A void event is recorded permanently; the market reopens.`)) return;
                                run(() => api("/api/void", { marketId: m.id, reason: "voided by operator" }));
                              }}
                            >
                              Undo result
                            </button>
                          )}
                        </div>
                      </div>
                      <CallList calls={calls} state={state} voiceName={voiceName} colorOf={colorOf} outcome={yes} />
                    </article>
                  );
                })}
              </>
            )}
          </div>

          <aside className="col-side">
            <section className="card">
              <div className="section-head tight">
                <h2>Track record</h2>
                <span className="count">{board.length} forecasters</span>
              </div>
              {board.map((v, rank) => {
                const w = byVoice.get(v.id);
                const color = colorOf(v.id);
                const overall = w?.overall ?? 1;
                return (
                  <div className="voice" key={v.id}>
                    <span className="avatar" style={{ background: color }}>
                      {v.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="v-main">
                      <div className="v-top">
                        <strong>{v.name}</strong>
                        <span className="pill soft">{v.kind}</span>
                        <span className={`pill tag ${trackTag(w).cls}`}>{trackTag(w).text}</span>
                      </div>
                      <div className="bar">
                        <i style={{ width: `${Math.min(100, (overall / 3) * 100)}%`, background: color }} />
                      </div>
                      <div className="cats">
                        {Object.entries(w?.byCategory ?? {}).map(([c, x]) => (
                          <span key={c}>
                            {c} <b>{x.toFixed(2)}</b>
                          </span>
                        ))}
                        <span className="muted">· {w?.nResolved ?? 0} graded</span>
                      </div>
                    </div>
                    <div className="v-side">
                      <b className="score">{overall.toFixed(2)}</b>
                      <Sparkline values={state.history.map((h) => h.weights[v.id] ?? 1)} color={color} />
                      {rank === 0 && (w?.nResolved ?? 0) > 0 && <span className="crown">most trusted</span>}
                    </div>
                  </div>
                );
              })}
              <p className="foot">1.00 = no better than a coin flip. Higher = right more often than chance. 0.10 = confidently wrong.</p>
            </section>

            <section className="card">
              <div className="section-head tight">
                <h2>Track record over time</h2>
              </div>
              {state.history.length === 0 ? (
                <p className="empty small">Enter a result and each forecaster&apos;s line starts moving here.</p>
              ) : (
                <>
                  <WeightChart
                    series={state.voices.map((v) => ({ name: v.name, color: colorOf(v.id), values: state.history.map((h) => h.weights[v.id] ?? 1) }))}
                    labels={state.history.map((h) => h.question)}
                  />
                  <div className="legend">
                    {state.voices.map((v) => (
                      <span key={v.id}>
                        <i style={{ background: colorOf(v.id) }} />
                        {v.name}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </section>

            {canWrite && (
              <section className="card">
                <div className="section-head tight">
                  <h2>Add a forecaster</h2>
                </div>
                <AddVoice busy={busy} onAdd={(name, kind) => run(() => api("/api/voices", { name, kind }))} />
              </section>
            )}
          </aside>
        </main>
      )}

      {walletOpen && (
        <WalletModal
          onClose={() => setWalletOpen(false)}
          onDone={(a) => {
            setAddress(a);
            setWalletOpen(false);
            switchScope("me");
          }}
        />
      )}

      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button onClick={() => setError("")} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function SealChip({ call, stored }: { call: Call; stored: boolean }) {
  return (
    <span className="seals">
      {call.seal.mode === "sui-mainnet" && call.seal.digest ? (
        <a className={`s-chip ${call.seal.verified ? "ok" : "warn"}`} href={`https://suiscan.xyz/mainnet/tx/${call.seal.digest}`} target="_blank" rel="noopener noreferrer" title="Open the sealing transaction on Suiscan">
          locked in on Sui {call.seal.verified ? "✓" : "?"}
        </a>
      ) : (
        <span className="s-chip warn" title="Simulated seals are never counted as proof">
          practice only (not real proof)
        </span>
      )}
      <span className={`s-chip ${stored ? "ok" : "busy"}`}>{stored ? "saved ✓" : "saving…"}</span>
    </span>
  );
}

function CallList({ calls, state, voiceName, colorOf, outcome }: { calls: Call[]; state: State; voiceName: (id: string) => string; colorOf: (id: string) => string; outcome?: boolean }) {
  if (calls.length === 0) return <p className="empty small">No calls yet.</p>;
  return (
    <ul className="calls">
      {calls.map((c) => {
        const hit = outcome === undefined ? null : c.p > 0.5 === outcome;
        const brier = outcome === undefined ? null : (c.p - (outcome ? 1 : 0)) ** 2;
        return (
          <li key={c.id}>
            <i style={{ background: colorOf(c.voiceId) }} />
            <span className="c-name">{voiceName(c.voiceId)}</span>
            <b className="c-p">{pct(c.p)}</b>
            {hit !== null && <span className={`verdict ${hit ? "hit" : "miss"}`}>{hit ? "right" : "wrong"} · score {brier!.toFixed(2)} (0 is perfect)</span>}
            <SealChip call={c} stored={state.callStored[c.id] ?? false} />
          </li>
        );
      })}
    </ul>
  );
}

function AddVoice({ busy, onAdd }: { busy: boolean; onAdd: (name: string, kind: string) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("friend");
  const submit = () => {
    if (!name.trim()) return;
    onAdd(name, kind);
    setName("");
  };
  return (
    <div className="form-row">
      <input placeholder="Name, e.g. Sam, Poliwave, ChatGPT" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      <select value={kind} onChange={(e) => setKind(e.target.value)}>
        {["friend", "pundit", "model", "self"].map((k) => (
          <option key={k}>{k}</option>
        ))}
      </select>
      <button className="btn" disabled={busy || !name.trim()} onClick={submit}>
        Add
      </button>
    </div>
  );
}

function AddMarket({ busy, onAdd }: { busy: boolean; onAdd: (q: string, c: string, d: string) => void }) {
  const [q, setQ] = useState("");
  const [c, setC] = useState("nfl");
  const [d, setD] = useState(() => {
    const t = new Date(Date.now() + 24 * 3600_000);
    t.setMinutes(t.getMinutes() - t.getTimezoneOffset());
    return t.toISOString().slice(0, 16);
  });
  return (
    <div className="form-stack">
      <input placeholder="Will the Chiefs beat the Bills?" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="form-row">
        <input placeholder="category (nfl, politics…)" value={c} onChange={(e) => setC(e.target.value)} />
        <input type="datetime-local" value={d} onChange={(e) => setD(e.target.value)} />
        <button className="btn" disabled={busy || !q.trim() || !d} onClick={() => onAdd(q, c, new Date(d).toISOString())}>
          Create
        </button>
      </div>
    </div>
  );
}

function MakeCall({ busy, voices, onCall }: { busy: boolean; voices: Voice[]; onCall: (voiceId: string, p: number) => void }) {
  const [voiceId, setVoiceId] = useState("");
  const [p, setP] = useState(60);
  const chosen = voiceId || voices[0]?.id || "";
  if (voices.length === 0) return <p className="insight">Add a forecaster in the panel on the right, then lock in their prediction here.</p>;
  return (
    <div className="make-call">
      <select value={chosen} onChange={(e) => setVoiceId(e.target.value)} aria-label="Voice">
        {voices.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
      <label className="slider">
        <input type="range" min={1} max={99} value={p} onChange={(e) => setP(Number(e.target.value))} aria-label="Probability of YES" />
        <b>says {p}% YES</b>
      </label>
      <button className="btn" disabled={busy || !chosen} onClick={() => onCall(chosen, p / 100)}>
        Lock in prediction
      </button>
    </div>
  );
}

function AdminBar({ admin, required, onChange }: { admin: boolean; required: boolean; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  if (!required) return null;
  if (admin) {
    return (
      <button
        className="btn ghost"
        onClick={() => {
          try {
            localStorage.removeItem(TOKEN_KEY);
          } catch {}
          onChange();
        }}
      >
        Sign out of admin
      </button>
    );
  }
  const submit = () => {
    try {
      localStorage.setItem(TOKEN_KEY, value.trim());
    } catch {}
    setValue("");
    setOpen(false);
    onChange();
  };
  return (
    <>
      <span className="chip muted-solid">Read-only view</span>
      {open ? (
        <>
          <input type="password" autoFocus placeholder="Admin token" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
          <button className="btn" disabled={!value.trim()} onClick={submit}>
            Sign in
          </button>
        </>
      ) : (
        <button className="btn ghost" onClick={() => setOpen(true)}>
          Admin sign-in
        </button>
      )}
    </>
  );
}

function trackTag(w: VoiceWeight | undefined): { text: string; cls: string } {
  if (!w || w.nResolved === 0) return { text: "not scored yet", cls: "none" };
  if (w.overall >= 1.3) return { text: "reliable", cls: "good" };
  if (w.overall < 0.7) return { text: "unreliable", cls: "bad" };
  return { text: "mixed", cls: "mid" };
}

function Guide({ state, canWrite }: { state: State; canWrite: boolean }) {
  const nVoices = state.voices.length;
  const nCalls = state.calls.length;
  const nDone = Object.keys(state.resolved).length;
  const step = nDone > 0 ? 4 : nCalls > 0 ? 3 : nVoices > 0 ? 2 : 1;
  const steps = [
    { title: "Add forecasters", detail: `${nVoices} added` },
    { title: "Lock in predictions", detail: `${nCalls} locked in` },
    { title: "Enter the result", detail: `${nDone} answered` },
    { title: "Read the track record", detail: "who to trust" },
  ];
  const message = !canWrite
    ? "You are looking at a read-only copy. Scroll down to see each forecaster's predictions and track record."
    : [
        "",
        "Start here: add the forecasters you want to track, using the box on the right.",
        "Next: on a question below, choose a forecaster, set what they said (for example 70% YES) and press Lock in prediction.",
        "Next: when the real result of a question is known, press Result: YES or Result: NO on it. That is when forecasters get scored.",
        "Done: the track record board now shows who has been right, and new questions lean towards them.",
      ][step];
  return (
    <section className="guide">
      <ol className="guide-steps">
        {steps.map((st, i) => (
          <li key={st.title} className={i + 1 < step ? "done" : i + 1 === step ? "now" : ""}>
            <span>{i + 1 < step ? "✓" : i + 1}</span>
            <div>
              <b>{st.title}</b>
              <small>{st.detail}</small>
            </div>
          </li>
        ))}
      </ol>
      <p className="guide-msg">{message}</p>
      <p className="how-link">
        New here? <a href="/#how">See how CallBook works</a>.
      </p>
    </section>
  );
}

function WalletModal({ onClose, onDone }: { onClose: () => void; onDone: (address: string) => void }) {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    const update = () => setWallets(listSuiWallets());
    update();
    return onWalletsChange(update);
  }, []);
  async function pick(w: Wallet) {
    setBusy(w.name);
    setErr("");
    try {
      onDone(await signInWithWallet(w));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Connect a wallet" onClick={(e) => e.stopPropagation()}>
        <div className="diff-head">
          <h2>Connect a Sui wallet</h2>
          <button className="x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p className="modal-note">You will be asked to sign one free message. No transaction is sent and nothing is spent.</p>
        {wallets.length === 0 ? (
          <p className="insight">
            No Sui wallet was found in this browser. Install a wallet such as{" "}
            <a href="https://slush.app" target="_blank" rel="noopener noreferrer">
              Slush
            </a>
            , create or import an account, then reload this page.
          </p>
        ) : (
          <ul className="wallets">
            {wallets.map((w) => (
              <li key={w.name}>
                <button className="wallet-row" disabled={busy !== ""} onClick={() => pick(w)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={w.icon} alt="" width={28} height={28} />
                  <span>{w.name}</span>
                  <em>{busy === w.name ? "Waiting for your wallet…" : "Connect"}</em>
                </button>
              </li>
            ))}
          </ul>
        )}
        {err && <p className="toast-inline">{err}</p>}
      </div>
    </div>
  );
}
