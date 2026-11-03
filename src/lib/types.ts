export type VoiceKind = "friend" | "pundit" | "model" | "self" | "user";

export interface Voice {
  id: string;
  name: string;
  kind: VoiceKind;
  /** Wallet address, for forecasters who signed in and predict for themselves. */
  owner?: string;
}

/** A question about the future that voices make calls on. */
export interface Market {
  id: string;
  question: string;
  category: string;
  /** ISO time after which new calls no longer count. */
  closesAt: string;
}

/** Proof that a call existed before the market closed. */
export interface SealProof {
  /** "sui-mainnet" = commitment is in a real Sui tx; "simulated" = local stand-in, never counted as proof. */
  mode: "sui-mainnet" | "simulated";
  digest?: string;
  /** Checkpoint timestamp of the sealing tx, read back through Tatum. */
  timestampMs: number;
  /** True only when the tx was read back via Tatum and contains the commitment. */
  verified: boolean;
}

export interface Call {
  id: string;
  marketId: string;
  voiceId: string;
  /** Probability (0..1) that the market resolves YES. */
  p: number;
  nonce: string;
  /** Wallet address of the signed-in user who made the call (absent on the featured operator ledger). */
  owner?: string;
  /** sha256 hex of the canonical call payload. This is what is written into the Sui tx. */
  commitment: string;
  seal: SealProof;
}

export interface Resolution {
  marketId: string;
  yes: boolean;
  resolvedAt: string;
}

export type LedgerEvent = (
  | { t: "voice"; voice: Voice }
  | { t: "market"; market: Market }
  | { t: "call"; call: Call }
  | { t: "resolution"; resolution: Resolution }
  /** Cancels the latest resolution of a market (the ledger is append-only, so mistakes are voided, never deleted). */
  | { t: "void"; marketId: string; reason: string }
) & {
  /** Strictly increasing append order. Recall returns memories by relevance, so rebuilds sort on this. */
  at?: number;
};

/** One scored observation of a voice. */
export interface Scored {
  p: number;
  yes: boolean;
  category: string;
}

export interface VoiceWeight {
  voiceId: string;
  overall: number;
  byCategory: Record<string, number>;
  nResolved: number;
}

export interface Consensus {
  marketId: string;
  weighted: number;
  naive: number;
  nCalls: number;
}
