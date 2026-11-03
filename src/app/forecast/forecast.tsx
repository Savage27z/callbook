"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Call, Consensus, Market, Voice, VoiceWeight } from "@/lib/types.ts";
import { colorFor, ConsensusTrack, Sparkline, type CallDot } from "../charts.tsx";
import { WalletModal } from "../wallet-modal.tsx";
import "../dashboard.css";

interface State {
  modes: { memory: string; sui: string };
  memoriesWritten: number;
  voices: Voice[];
  weights: VoiceWeight[];
  markets: Market[];
  calls: Call[];
  resolved: Record<string, boolean>;
  consensus: Consensus[];
  history: { marketId: string; weights: Record<string, number> }[];
  viewer: { address: string; voiceId: string } | null;
}

async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Something went wrong");
  return json as T;
}

const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function closesIn(iso: string, now: number): string {
  const ms = Date.parse(iso) - now;
  if (ms <= 0) return "closed";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `closes in ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `closes in ${h}h ${m % 60}m`;
  return `closes in ${Math.floor(h / 24)} days`;
}

function tag(w: VoiceWeight | undefined) {
  if (!w || w.nResolved === 0) return { text: "not scored yet", cls: "none" };
  if (w.overall >= 1.3) return { text: "reliable", cls: "good" };
  if (w.overall < 0.7) return { text: "unreliable", cls: "bad" };
  return { text: "mixed", cls: "mid" };
}

const LOGO = (
  <svg viewBox="0 0 80 80" aria-hidden="true">
    <circle cx="40" cy="40" r="35" fill="none" stroke="currentColor" strokeWidth="6" />
    <path d="M26 42 36 53 55 28" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function Forecast() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [walletOpen, setWalletOpen] = useState(false);
  const [tab, setTab] = useState<"open" | "answered">("open");
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => setState(await api<State>("/api/state")), []);
  useEffect(() => {
    refresh().catch((e) => setError(String(e.message ?? e)));
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  const d = useMemo(() => {
    if (!state) return null;
    const idx = new Map(state.voices.map((v, i) => [v.id, i]));
    const byVoice = new Map(state.weights.map((w) => [w.voiceId, w]));
    const cons = new Map(state.consensus.map((c) => [c.marketId, c]));
    const open = state.markets.filter((m) => !(m.id in state.resolved)).sort((a, b) => Date.parse(a.closesAt) - Date.parse(b.closesAt));
    const answered = state.markets.filter((m) => m.id in state.resolved).reverse();
    const board = [...state.voices].sort((a, b) => (byVoice.get(b.id)?.overall ?? 1) - (byVoice.get(a.id)?.overall ?? 1));
    return { idx, byVoice, cons, open, answered, board };
  }, [state]);

  if (!state || !d) return <div className="cb"><div className="cb-loading">{error || "Loading questions…"}</div></div>;

  const me = state.viewer;
  const myId = me?.voiceId;
  const colorOf = (id: string) => colorFor(d.idx.get(id) ?? 0);
  const nameOf = (id: string) => state.voices.find((v) => v.id === id)?.name ?? id;
  const players = state.voices.filter((v) => v.kind === "user").length;
  const myW = myId ? d.byVoice.get(myId) : undefined;
  const scored = d.board.filter((v) => (d.byVoice.get(v.id)?.nResolved ?? 0) > 0);
  const myRank = myId ? scored.findIndex((v) => v.id === myId) + 1 : 0;

  async function lockIn(m: Market) {
    const p = (picks[m.id] ?? 60) / 100;
    if (!window.confirm(`Lock in ${Math.round(p * 100)}% YES on:\n\n${m.question}\n\nPredictions are final: you can't change it afterwards.`)) return;
    setBusyId(m.id);
    setError("");
    try {
      await api("/api/predict", { marketId: m.id, p });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId("");
    }
  }

  const list = tab === "open" ? d.open : d.answered;

  return (
    <div className="cb">
      <nav className="cb-nav">
        <a className="brand" href="/" aria-label="CallBook home">
          {LOGO}
          callbook
        </a>
        <a className="navlink" href="/#how">
          How it works
        </a>
        {me ? (
          <button
            className="btn ghost"
            title={me.address}
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              await refresh();
            }}
          >
            {short(me.address)} · Sign out
          </button>
        ) : (
          <button className="btn" onClick={() => setWalletOpen(true)}>
            Sign in
          </button>
        )}
      </nav>

      <header className="banner">
        <div className="banner-bg" aria-hidden />
        <div className="banner-in">
          <span className="pill">Prediction track record</span>
          <h1>Make predictions. Earn trust.</h1>
          <p className="lede">Pick a probability on real questions before they happen. When the result is in, you get scored. The more often you are right, the more your forecast counts.</p>
          <div className="tickets">
            <div className="ticket"><small>Open questions</small><b>{d.open.length}</b></div>
            <div className="ticket"><small>Players</small><b>{players}</b></div>
            <div className="ticket"><small>Predictions locked in</small><b>{state.calls.length}</b></div>
            <div className="ticket"><small>Questions answered</small><b>{d.answered.length}</b></div>
          </div>
        </div>
      </header>

      <main className="layout">
        <div className="col-main">
          <div className="section-head">
            <div className="scope" role="tablist">
              <button role="tab" aria-selected={tab === "open"} className={tab === "open" ? "on" : ""} onClick={() => setTab("open")}>
                Open ({d.open.length})
              </button>
              <button role="tab" aria-selected={tab === "answered"} className={tab === "answered" ? "on" : ""} onClick={() => setTab("answered")}>
                Answered ({d.answered.length})
              </button>
            </div>
          </div>

          {list.length === 0 && <p className="empty">{tab === "open" ? "No open questions right now." : "Nothing has been answered yet. Results appear here once the outcome is known."}</p>}

          {list.map((m) => {
            const c = d.cons.get(m.id);
            const calls = state.calls.filter((x) => x.marketId === m.id);
            const mine = calls.find((x) => x.voiceId === myId);
            const isOpen = !(m.id in state.resolved);
            const outcome = state.resolved[m.id];
            const dots: CallDot[] = calls.map((x) => ({ voice: nameOf(x.voiceId), color: colorOf(x.voiceId), p: x.p, weight: d.byVoice.get(x.voiceId)?.byCategory[m.category] ?? 1 }));
            const pick = picks[m.id] ?? 60;
            const closed = Date.parse(m.closesAt) <= now;
            return (
              <article className={`card market ${isOpen ? "" : "resolved"}`} key={m.id}>
                <div className="market-top">
                  <h3>{m.question}</h3>
                  <div className="pills">
                    <span className="pill">{m.category}</span>
                    {isOpen ? <span className="pill soft">{closesIn(m.closesAt, now)}</span> : <span className={`pill outcome ${outcome ? "yes" : "no"}`}>Result: {outcome ? "YES" : "NO"}</span>}
                  </div>
                </div>

                {c ? (
                  <div className="forecast">
                    <div>
                      <small>Community forecast</small>
                      <b>{pct(c.weighted)}</b>
                      <span>YES</span>
                    </div>
                    <p>
                      Based on {c.nCalls} {c.nCalls === 1 ? "forecast" : "forecasts"}, weighted by track record. Simple average: {pct(c.naive)}.
                    </p>
                  </div>
                ) : (
                  <p className="empty small">No forecasts yet. Be the first.</p>
                )}
                {dots.length > 0 && <ConsensusTrack dots={dots} weighted={c ? c.weighted : null} naive={c ? c.naive : null} />}

                {calls.filter((x) => x.voiceId !== myId).length > 0 && (
                  <ul className="calls">
                    {calls
                      .filter((x) => x.voiceId !== myId)
                      .map((x) => (
                        <li key={x.id}>
                          <i style={{ background: colorOf(x.voiceId) }} />
                          <span className="c-name">{nameOf(x.voiceId)}</span>
                          <b className="c-p">{pct(x.p)}</b>
                          {!isOpen && <span className={`verdict ${x.p > 0.5 === outcome ? "hit" : "miss"}`}>{x.p > 0.5 === outcome ? "right" : "wrong"}</span>}
                        </li>
                      ))}
                  </ul>
                )}

                {mine ? (
                  <div className="mine">
                    <b>Your prediction: {pct(mine.p)} YES</b>
                    {isOpen ? (
                      <span>locked in{mine.seal.mode === "sui-mainnet" && mine.seal.digest ? (
                        <>
                          {" "}
                          · <a href={`https://suiscan.xyz/mainnet/tx/${mine.seal.digest}`} target="_blank" rel="noopener noreferrer">proof on Sui</a>
                        </>
                      ) : null}</span>
                    ) : (
                      <span className={`verdict ${mine.p > 0.5 === outcome ? "hit" : "miss"}`}>
                        {mine.p > 0.5 === outcome ? "you were right" : "you were wrong"} · score {((mine.p - (outcome ? 1 : 0)) ** 2).toFixed(2)} (0 is perfect)
                      </span>
                    )}
                  </div>
                ) : isOpen && !closed ? (
                  me ? (
                    <div className="make-call">
                      <label className="slider">
                        <input type="range" min={1} max={99} value={pick} onChange={(e) => setPicks({ ...picks, [m.id]: Number(e.target.value) })} aria-label="Your probability of YES" />
                        <b>{pick}% YES</b>
                      </label>
                      <button className="btn" disabled={busyId === m.id} onClick={() => lockIn(m)}>
                        {busyId === m.id ? "Locking in…" : "Lock in prediction"}
                      </button>
                    </div>
                  ) : (
                    <div className="make-call">
                      <span className="muted-line">Sign in to make your own prediction.</span>
                      <button className="btn" onClick={() => setWalletOpen(true)}>
                        Sign in
                      </button>
                    </div>
                  )
                ) : null}
              </article>
            );
          })}
        </div>

        <aside className="col-side">
          {me && (
            <section className="card you">
              <div className="section-head tight">
                <h2>Your track record</h2>
                <span className={`pill tag ${tag(myW).cls}`}>{tag(myW).text}</span>
              </div>
              {myW && myW.nResolved > 0 ? (
                <p className="you-line">
                  <b>{myW.overall.toFixed(2)}</b> <span>trust score</span> · {myRank > 0 ? `#${myRank} of ${scored.length}` : ""} · {myW.nResolved} scored
                </p>
              ) : (
                <p className="empty small">Make predictions now. You get a score once a question you predicted is answered.</p>
              )}
            </section>
          )}

          <section className="card">
            <div className="section-head tight">
              <h2>Leaderboard</h2>
              <span className="count">{d.board.length} forecasters</span>
            </div>
            {d.board.length === 0 && <p className="empty small">No forecasters yet.</p>}
            {d.board.slice(0, 10).map((v, i) => {
              const w = d.byVoice.get(v.id);
              const t = tag(w);
              return (
                <div className={`voice ${v.id === myId ? "me" : ""}`} key={v.id}>
                  <span className="avatar" style={{ background: colorOf(v.id) }}>{v.id === myId ? "Y" : v.kind === "user" ? "P" : v.name.slice(0, 1).toUpperCase()}</span>
                  <div className="v-main">
                    <div className="v-top">
                      <strong>{v.id === myId ? "You" : v.name}</strong>
                      <span className="pill soft">{v.kind === "user" ? "player" : v.kind === "self" ? "operator" : "expert"}</span>
                      <span className={`pill tag ${t.cls}`}>{t.text}</span>
                    </div>
                    <div className="bar"><i style={{ width: `${Math.min(100, ((w?.overall ?? 1) / 3) * 100)}%`, background: colorOf(v.id) }} /></div>
                  </div>
                  <div className="v-side">
                    <b className="score">{(w?.overall ?? 1).toFixed(2)}</b>
                    <Sparkline values={state.history.map((h) => h.weights[v.id] ?? 1)} color={colorOf(v.id)} />
                    {i === 0 && (w?.nResolved ?? 0) > 0 && <span className="crown">top</span>}
                  </div>
                </div>
              );
            })}
            <p className="foot">1.00 means no better than a coin flip. Higher means right more often than chance.</p>
          </section>

          <p className="how-link">
            How scoring works: <a href="/#how">see how CallBook works</a>. Records are saved on Walrus and each prediction is time-stamped on Sui.
          </p>
        </aside>
      </main>

      {walletOpen && (
        <WalletModal
          onClose={() => setWalletOpen(false)}
          onDone={async () => {
            setWalletOpen(false);
            await refresh();
          }}
        />
      )}
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button onClick={() => setError("")} aria-label="Dismiss">×</button>
        </div>
      )}
    </div>
  );
}
