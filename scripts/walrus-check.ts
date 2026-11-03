// Read-only check of Walrus Memory credentials: key matches the dashboard's public key, relayer is healthy, recall works.
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { MemWal } from "@mysten-incubation/memwal";

const hex = process.env.MEMWAL_PRIVATE_KEY!;
const expectedPub = process.argv[2];
const kp = Ed25519Keypair.fromSecretKey(Uint8Array.from(Buffer.from(hex, "hex")));
const pub = Buffer.from(kp.getPublicKey().toRawBytes()).toString("hex");
console.log("delegate public key matches dashboard:", pub === expectedPub);

const memwal = MemWal.create({
  key: hex,
  accountId: process.env.MEMWAL_ACCOUNT_ID!,
  serverUrl: process.env.MEMWAL_SERVER_URL,
  namespace: process.env.MEMWAL_NAMESPACE ?? "callbook",
});
console.log("health:", JSON.stringify(await memwal.health()));
const r = await memwal.recall({ query: "CALLBOOK/v1 ledger event", topK: 5 });
console.log("recall ok, memories in namespace:", r.total);
