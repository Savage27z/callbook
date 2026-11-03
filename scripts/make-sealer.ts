// Generates a fresh Sui keypair for sealing calls and writes the private key into .env (never printed).
import { readFileSync, writeFileSync } from "node:fs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

const envPath = ".env";
const env = readFileSync(envPath, "utf8");
if (/^SEALER_PRIVATE_KEY=.+$/m.test(env)) throw new Error("SEALER_PRIVATE_KEY is already set in .env; refusing to overwrite it.");
const kp = Ed25519Keypair.generate();
const next = /^SEALER_PRIVATE_KEY=.*$/m.test(env)
  ? env.replace(/^SEALER_PRIVATE_KEY=.*$/m, `SEALER_PRIVATE_KEY=${kp.getSecretKey()}`)
  : `${env.trimEnd()}\nSEALER_PRIVATE_KEY=${kp.getSecretKey()}\n`;
writeFileSync(envPath, next);
console.log("Sealer address (fund this with SUI):", kp.toSuiAddress());
