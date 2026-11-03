import { createHash, randomBytes } from "node:crypto";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import type { Call, SealProof } from "./types.ts";

/**
 * Sealing: the sha256 commitment of a call is passed as an argument to `0x1::string::utf8`
 * inside a Sui transaction. Pure inputs are part of the signed transaction data, so the
 * commitment is permanently on chain without deploying any Move package. We then read the
 * transaction back through Tatum's Sui gRPC gateway and check that (a) it succeeded,
 * (b) the commitment bytes are in its inputs, and (c) take its checkpoint timestamp as the
 * time the call provably existed.
 */
// Note: the commitment is read back from the tx inputs; see readBack().

export function commitmentFor(c: Pick<Call, "marketId" | "voiceId" | "p" | "nonce"> & { owner?: string }): string {
  // `owner` is only part of the hash when set, so calls on the featured ledger keep their original format.
  const canonical = JSON.stringify({ marketId: c.marketId, voiceId: c.voiceId, p: c.p, nonce: c.nonce, ...(c.owner ? { owner: c.owner } : {}) });
  return createHash("sha256").update(canonical).digest("hex");
}

export function newNonce(): string {
  return randomBytes(8).toString("hex");
}

export function suiConfigured(): boolean {
  return Boolean(process.env.TATUM_API_KEY && process.env.SEALER_PRIVATE_KEY);
}

/**
 * Tatum's Sui mainnet HTTP gateway is GraphQL-only, and its gRPC endpoint is native gRPC (not
 * gRPC-web), which the SDK's browser-style transport cannot speak. So we go through Tatum's
 * GraphQL gateway.
 */
function client(): SuiGraphQLClient {
  const key = process.env.TATUM_API_KEY;
  if (!key) throw new Error("TATUM_API_KEY is not set");
  return new SuiGraphQLClient({
    network: "mainnet",
    url: process.env.TATUM_SUI_GRAPHQL_URL ?? "https://sui-mainnet.gateway.tatum.io/graphql",
    headers: { "x-api-key": key },
  });
}

/**
 * The commitment goes on chain as its hex text, because `0x1::string::utf8` aborts on bytes that
 * are not valid UTF-8 and raw hash bytes usually are not. Hex digits are plain ASCII, so always valid.
 */
function commitmentBytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, "utf8"));
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

export interface ReadBack {
  ok: boolean;
  status: string;
  timestampMs: number | null;
  commitmentPresent: boolean;
}

/** Read a sealing tx back through Tatum and check it really carries `commitmentHex`. */
export async function readBack(digest: string, commitmentHex: string): Promise<ReadBack> {
  const sui = client();
  const res = await sui.core.getTransaction({ digest, include: { transaction: true } });
  const tx = res.$kind === "Transaction" ? res.Transaction : res.FailedTransaction;
  const needle = commitmentBytes(commitmentHex);
  const inputs = (tx.transaction?.inputs ?? []) as { Pure?: { bytes: string } }[];
  const present = inputs.some((i) => i.Pure && containsBytes(Uint8Array.from(Buffer.from(i.Pure.bytes, "base64")), needle));
  const succeeded = res.$kind === "Transaction" && tx.status.success === true;
  return {
    ok: succeeded && present && tx.timestampMs !== null,
    status: succeeded ? "success" : "failed",
    timestampMs: tx.timestampMs,
    commitmentPresent: present,
  };
}

export async function sealCommitment(commitmentHex: string): Promise<SealProof> {
  if (!suiConfigured()) {
    // Honest fallback: clearly labelled, never counted as proof by scoring.ts.
    return { mode: "simulated", timestampMs: Date.now(), verified: false };
  }
  const sui = client();
  const signer = Ed25519Keypair.fromSecretKey(process.env.SEALER_PRIVATE_KEY!);
  const tx = new Transaction();
  tx.setSender(signer.toSuiAddress());
  tx.moveCall({ target: "0x1::string::utf8", arguments: [tx.pure.vector("u8", Array.from(commitmentBytes(commitmentHex)))] });
  const sent = await sui.signAndExecuteTransaction({ transaction: tx, signer });
  const digest = (sent.$kind === "Transaction" ? sent.Transaction : sent.FailedTransaction).digest;
  await sui.core.waitForTransaction({ digest });
  const back = await readBack(digest, commitmentHex);
  return { mode: "sui-mainnet", digest, timestampMs: back.timestampMs ?? Date.now(), verified: back.ok };
}
