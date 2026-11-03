// Read-only check: Tatum Sui GraphQL gateway answers through the SDK client with this API key.
import { SuiGraphQLClient } from "@mysten/sui/graphql";
const key = process.env.TATUM_API_KEY;
if (!key) throw new Error("TATUM_API_KEY not set");
const sui = new SuiGraphQLClient({
  network: "mainnet",
  url: process.env.TATUM_SUI_GRAPHQL_URL ?? "https://sui-mainnet.gateway.tatum.io/graphql",
  headers: { "x-api-key": key },
});
const state = await sui.core.getCurrentSystemState();
console.log("ok, epoch:", state.systemState.epoch);
// Look up a real recent transaction to confirm digest, timestamp and pure inputs come back.
const q = await sui.query({ query: "{ transactions(last: 1) { nodes { digest } } }" } as never) as { data?: { transactions: { nodes: { digest: string }[] } } };
const digest = q.data?.transactions.nodes[0]?.digest;
if (digest) {
  const r = await sui.core.getTransaction({ digest, include: { transaction: true } });
  const tx = r.$kind === "Transaction" ? r.Transaction : r.FailedTransaction;
  console.log("tx", digest.slice(0, 10), "timestampMs", tx.timestampMs, "inputs", tx.transaction?.inputs.length);
}
