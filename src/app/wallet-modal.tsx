"use client";

import { useEffect, useState } from "react";
import type { Wallet } from "@mysten/wallet-standard";
import { listSuiWallets, onWalletsChange, signInWithWallet } from "./wallet.ts";

/** Pick a Sui wallet, sign the one free sign-in message, and report the verified address. */
export function WalletModal({ onClose, onDone }: { onClose: () => void; onDone: (address: string) => void }) {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [busy, setBusy] = useState("");
  async function guest() {
    setBusy("guest");
    setErr("");
    try {
      const res = await fetch("/api/auth/guest", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not start a guest session");
      onDone(json.address as string);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }
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
      <div className="modal" role="dialog" aria-modal="true" aria-label="Sign in with a wallet" onClick={(e) => e.stopPropagation()}>
        <div className="diff-head">
          <h2>Start predicting</h2>
          <button className="x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <button className="btn guest-btn" disabled={busy !== ""} onClick={guest}>
          {busy === "guest" ? "Starting…" : "Continue as guest"}
        </button>
        <p className="modal-note">No wallet needed. Your record is tied to this browser, so clearing your cookies starts you over.</p>
        <p className="modal-or">or use a Sui wallet</p>
        <p className="modal-note">You sign one free message to prove the wallet is yours. No transaction is sent and nothing is spent.</p>
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
                  <em>{busy === w.name ? "Waiting for your wallet…" : "Sign in"}</em>
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
