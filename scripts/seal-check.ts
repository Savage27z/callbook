// Checks the sealer wallet balance, performs ONE real seal on Sui mainnet, reads it back through Tatum, reports gas.
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { commitmentFor, newNonce, readBack, sealCommitment } from "../src/lib/sui.ts";

const kp = Ed25519Keypair.fromSecretKey(process.env.SEALER_PRIVATE_KEY!);
const address = kp.toSuiAddress();
const sui = new SuiGraphQLClient({
  network: "mainnet",
  url: process.env.TATUM_SUI_GRAPHQL_URL ?? "https://sui-mainnet.gateway.tatum.io/graphql",
  headers: { "x-api-key": process.env.TATUM_API_KEY! },
});
const bal = async () => BigInt((await sui.core.getBalance({ owner: address })).balance.balance);
const fmt = (m: bigint) => `${Number(m) / 1e9} SUI (${m} MIST)`;

const before = await bal();
console.log("address", address);
console.log("balance before:", fmt(before));
if (before === 0n) {
  console.log("No SUI yet; nothing sent or sealed.");
  process.exit(0);
}
if (process.argv[2] !== "seal") {
  console.log("Balance OK. Re-run with `seal` to perform one real seal.");
  process.exit(0);
}

const base = { marketId: "seal-check", voiceId: "seal-check", p: 0.5, nonce: newNonce() };
const commitment = commitmentFor(base);
const t0 = Date.now();
const proof = await sealCommitment(commitment);
console.log("sealed in", Date.now() - t0, "ms:", JSON.stringify(proof));
const back = await readBack(proof.digest!, commitment);
console.log("read back via Tatum:", JSON.stringify(back));
const after = await bal();
console.log("balance after:", fmt(after), "| gas cost:", fmt(before - after));
