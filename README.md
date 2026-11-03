# CallBook

**A report card for people who make predictions.** Players lock in probabilities on real questions *before* an event, the result is entered afterwards, and everyone is scored. The more often you are right, the more your forecast counts.

Built for the **Tatum x Walrus "Total Recall" hackathon**, track **Markets & Sports Prediction**.

- Repository: https://github.com/Savage27z/callbook
- Live app: https://callbook-jade.vercel.app
- Blog post: _add the published post here_
- Demo video: _add the link here_

## How it works

1. **Lock in a prediction.** Pick a probability (1% to 99% YES) on an open question. The prediction's hash is written into a **Sui mainnet transaction**, so it provably existed before the question closed. Predictions are final: no edits.
2. **Enter the result.** When the event is over, the operator enters YES or NO. Each prediction is scored with a **Brier score** (0 is perfect, 1 is confidently wrong).
3. **Trust moves.** Every forecaster's track record is **remembered in Walrus Memory**. The community forecast on each open question is an average that listens more to forecasters with a better record, shown next to the simple average.

Two kinds of forecasters share one leaderboard:

- **Players** sign in with a Sui wallet at `/app` and predict for themselves.
- **Experts** (forecasting sites, pundits, models) are logged by the operator, who transcribes the number each one published at the time. This is labelled as such.

| Address | What it is |
|---|---|
| `/` | Landing page |
| `/app` | The player experience: questions, your prediction, community forecast, leaderboard |
| `/operator` | Backstage for whoever runs the ledger: add questions, enter results, log expert predictions |

## Where Walrus and Tatum are used

**Walrus Memory (mainnet)** is the source of truth for the whole ledger.

- Every voice, question, prediction, result and void is written as a memory with the `@mysten-incubation/memwal` SDK, in batches (`rememberBulkAndWait`), under one namespace.
- The local JSON file is only a cache. If it is missing, the app **rebuilds the entire ledger from Walrus on startup** (`recall`, sorted by a strictly increasing event counter). This is covered by a live test and exposed as a "Rebuild from Walrus" button.
- The ledger is **append-only**. A mistaken result is cancelled with a recorded `void` event; nothing is deleted.

**Tatum (Sui mainnet)** is how the app proves and re-checks timing.

- A prediction's commitment is `sha256` of `{questionId, forecasterId, probability, nonce[, wallet]}`. It is written into a Sui transaction (as the hex text, because `0x1::string::utf8` rejects raw hash bytes).
- The sealing transaction is then **read back through Tatum's Sui GraphQL gateway** (`https://sui-mainnet.gateway.tatum.io/graphql`). The call only counts as proof if the transaction succeeded, contains the commitment, and its checkpoint timestamp is before the question's close time. `POST /api/verify` re-runs this check for any prediction.
- Tatum's gRPC endpoint speaks native gRPC, which the Sui SDK's web transport cannot use, so GraphQL is the integration path.

**Credibility only counts real proof.** If the app runs without Sui keys it falls back to "simulated" seals, clearly labelled, and those never affect scores.

## Scoring

- Brier score per prediction: `(p - outcome)^2`.
- Skill ("edge") against a coin flip: `(0.25 - meanBrier) / 0.25`.
- Shrinkage: every estimate starts with 3 pseudo-observations of coin-flip skill, so one lucky call cannot make anyone an oracle. A category (for example `senate`) borrows the forecaster's record in other categories as its starting point.
- Weight: `clamp(1 + 2 * edge, 0.1, 3)`. 1.00 is a coin flip.
- The community forecast on an open question is `sum(weight * p) / sum(weight)` over each forecaster's latest prediction.
- While a question is open, **other players' predictions are hidden** (no herding). They still count toward the community forecast.

## Mainnet proof

Four expert predictions were sealed on Sui mainnet and read back through Tatum before the politics questions closed:

| Question | Forecaster | Prediction | Sui transaction |
|---|---|---|---|
| Democrats win Senate control | Decision Desk HQ | 64% | [`DeqGF5mJ…`](https://suiscan.xyz/mainnet/tx/DeqGF5mJRq1qTyWfDiCDsgR2iebz9QvpBTFRmdL2CWaw) |
| Democrats win Senate control | Poliwave | 76% | [`5mtAcwxh…`](https://suiscan.xyz/mainnet/tx/5mtAcwxhYjUaHT16tc9ChbVUGXx96jsaiX81GKvKzKMX) |
| Democrats win the House | Decision Desk HQ | 84% | [`EAfPMFeu…`](https://suiscan.xyz/mainnet/tx/EAfPMFeuxeCHSfdtKZDLx9uRuwPUcdXSZXuTYxrktR4c) |
| Democrats win the House | Poliwave | 88% | [`5oTTk61j…`](https://suiscan.xyz/mainnet/tx/5oTTk61jPN4avgc2FXEDwYCVncruUCW1taGkgsQg8tAT) |

The expert numbers were taken from the forecasters' published pages (via search summaries) and confirmed by the operator before sealing. A sealed prediction cannot be edited.

## Honest limitations

- **Experts are transcribed by the operator.** Poliwave and Decision Desk HQ do not use CallBook; the operator records what they published. Players predict for themselves.
- **Player records are hosted by the app**, in the operator's Walrus namespace, not in each player's own Walrus account. They are not user-owned memory. Wallet sign-in proves a wallet is yours; it does not yet sign each individual prediction, so attribution rests on the server.
- **Sign-in is untested with a real browser wallet in this repo's automated tests.** Signature verification, sessions and per-wallet rules are tested with generated keys. Google-login (zkLogin) wallet accounts are supported in code but unverified.
- **Writes are slow by nature:** a Walrus write takes roughly 20 to 25 seconds. The app queues writes and shows "saving…" until each lands.
- **Each prediction costs the operator a small amount of SUI** (about 0.0001 SUI per seal, measured once). Players are limited to one prediction per question and the player count is capped.
- Expert numbers for Iowa, Texas and Ohio were not logged because the sources published conflicting snapshots.

## Run it locally

Requires Node 22.23.4+ (see `engines`).

```bash
npm install
cp .env.example .env   # then fill it in
npm run dev            # http://localhost:3000
```

Without keys the app runs in **practice mode**: in-memory Walrus mock, simulated seals, and a "Load demo" button on `/operator`.

| Variable | Purpose |
|---|---|
| `MEMWAL_PRIVATE_KEY`, `MEMWAL_ACCOUNT_ID` | Walrus Memory delegate key and account (create at the Walrus Memory dashboard) |
| `MEMWAL_NAMESPACE` | Walrus namespace for the ledger (default `callbook`) |
| `TATUM_API_KEY` | Tatum key for the Sui GraphQL gateway |
| `SEALER_PRIVATE_KEY` | Sui key that pays gas for sealing (a fresh wallet with a little SUI) |
| `ADMIN_TOKEN` | Required for operator actions. **If unset in production, all operator writes are disabled.** |
| `SESSION_SECRET` | Signs wallet-login session cookies |
| `USER_MAX_EVENTS`, `MAX_USERS` | Demo limits that protect the operator's funds |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Only on serverless hosts: the Redis database that holds the shared working copy |

```bash
npm test              # 34 tests: scoring, sign-in, sessions, per-player rules, ledger behaviour, redis store and locks
npm run smoke         # end-to-end ledger run (practice mode)
npm run build && npm start
```

### MCP server (second client, same memory)

`mcp/server.ts` is a read-only MCP server over the same Walrus namespace, so any MCP client can ask who to trust:

```bash
npm run mcp
```

Tools: `callbook_credibility`, `callbook_open_markets`, `callbook_voice_history`.

## Deploy

The app keeps a working copy of the ledger (a fast index in front of Walrus) and pushes slow Walrus writes in the background. Two setups are supported:

**Vercel (serverless).** Every request can run on a different short-lived instance, so the working copy lives in a **Redis database** (Upstash, from the Vercel Storage tab) instead of a local file. Locks stored in Redis keep two instances from interleaving a write or double-pushing to Walrus, and Next's `after()` keeps a function alive until its Walrus write finishes. Set every variable in the table above plus `KV_REST_API_URL` and `KV_REST_API_TOKEN` (added automatically when you connect the Redis database). Functions need `maxDuration` of 120 seconds or more for the background writes (the API routes set it; your Vercel plan must allow it).

**A long-running Node host** (Railway, Fly, a VM). No Redis needed: the working copy is a JSON file. A `railway.json` is included.

In both cases the working copy is disposable: when it is empty the app **rebuilds the whole ledger from Walrus on the first request**. Set `ADMIN_TOKEN` and `SESSION_SECRET` on any public deployment; without `ADMIN_TOKEN`, operator writes are disabled.

## Stack

Next.js, TypeScript, `@mysten-incubation/memwal`, `@mysten/sui` (GraphQL client), `@mysten/wallet-standard`, `@modelcontextprotocol/sdk`, `@upstash/redis` (serverless deployments).

## License

MIT. See [LICENSE](LICENSE). The license covers this repository's code; the hotlinked landing-page artwork described below is not covered by it.

## Credits

The landing page's artwork and hero video are hotlinked from third-party URLs supplied with the design reference and are not part of this repository's own assets; replace them before reuse.
