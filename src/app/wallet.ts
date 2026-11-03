"use client";

import { getWallets, type Wallet, type WalletAccount } from "@mysten/wallet-standard";

/** Browser wallets that can connect and sign a message (Slush and any other wallet-standard Sui wallet). */
export function listSuiWallets(): Wallet[] {
  return getWallets()
    .get()
    .filter((w) => "standard:connect" in w.features && "sui:signPersonalMessage" in w.features);
}

/** Wallet extensions register themselves after page load, so the list has to be watched. */
export function onWalletsChange(cb: () => void): () => void {
  const api = getWallets();
  const offRegister = api.on("register", cb);
  const offUnregister = api.on("unregister", cb);
  return () => {
    offRegister();
    offUnregister();
  };
}

type ConnectFeature = { connect: () => Promise<{ accounts: readonly WalletAccount[] }> };
type SignFeature = { signPersonalMessage: (input: { message: Uint8Array; account: WalletAccount }) => Promise<{ signature: string }> };

/** Connect, sign the server's one-time message (free, no transaction) and let the server verify it. */
export async function signInWithWallet(wallet: Wallet): Promise<string> {
  const { accounts } = await (wallet.features["standard:connect"] as ConnectFeature).connect();
  const account = accounts.find((a) => a.chains.some((c) => c.startsWith("sui:"))) ?? accounts[0];
  if (!account) throw new Error("The wallet did not share an account");

  const nonceRes = await fetch("/api/auth/nonce");
  const { message } = (await nonceRes.json()) as { message: string };
  const { signature } = await (wallet.features["sui:signPersonalMessage"] as SignFeature).signPersonalMessage({
    message: new TextEncoder().encode(message),
    account,
  });

  const res = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: account.address, signature, message }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Sign-in failed");
  return json.address as string;
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}
