# Shared Hedera layer for day-1 testnet proof

Node lab/server tooling; it does not load into the Rust desktop or browser extension.
The full official JavaScript SDK is pinned to `@hiero-ledger/sdk` **2.90.1**
(Apache-2.0; https://registry.npmjs.org/@hiero-ledger%2fsdk/latest and
https://github.com/hiero-ledger/hiero-sdk-js/blob/main/LICENSE).
The package remains private pending RADIX's exact public-content/license decision.

Run `npm ci --ignore-scripts`, `npm test`, and `npm run test:mutations` here.
Node >=22.19 is required. Mirror HTTP uses the inherited HTTPS proxy and CA trust.
Consensus SDK transport also requires permitted testnet gRPC connectivity; changing
proxy configuration does not grant access. No endpoint overrides are accepted.

The caller provisions **only at run time** `HEDERA_OPERATOR_ID` and
`HEDERA_OPERATOR_KEY` (DER-encoded private key) through the process environment.
Do not put values into `.env`, command arguments, fixtures, test output or reports.
No account creation, faucet, funding, HBAR transfer or token operation is included.
An absent/invalid environment produces fixed error codes without SDK diagnostics.
SDK logging is silent. The smoke intentionally creates a lasting testnet topic.

`HEDERA_NETWORK` defaults to `testnet`. Only the exact names `testnet` and `mainnet`
are accepted. Future library mainnet selection requires the runtime switch
`RADIX_HEDERA_MAINNET_ENABLED=true`, set only by RADIX; a process cannot establish a
human's identity, so deployment access controls must restrict who can set it.
The smoke commands refuse mainnet even with that switch. Mainnet stays OFF here.

Each write has a fee limit (default/ceiling 100,000,000 tinybars), a fixed transaction
ID with regeneration disabled, bounded SDK/wrapper attempts, a SUCCESS receipt and
mandatory mirror proof. Failed/missing proof means unconfirmed, never success.
Retries reuse the prepared signed transaction; duplicate submission checks its receipt.
An ambiguous send is reconciled against the same receipt before declaring failure.
No new transaction ID is generated to recover an ambiguous result. Mirror polling is
bounded; the caller must not blindly repeat a failed operation as a new write.
Topic proof pins ID/memo/submit key; message proof pins ID/sequence/payer/exact bytes.
The smoke signs its JSON record with the topic submit key, verifies it locally,
then proves that the exact signed envelope reached the mirror. These controls do
not verify a product's semantic root, offline verifier or wallet ownership contract.

With a throwaway account funded only with testnet HBAR available in that environment,
set `HEDERA_TESTNET_THROWAWAY=true`, then run `npm run smoke:digigami`,
`smoke:latticeworks`, `smoke:token-auditor`, or `smoke:mobi`.
The same CLI accepts `digigami-audit` and `hedera-auction-integrity`; their repositories
provide thin wrappers rather than another SDK layer. Successful output contains only
public testnet evidence (IDs, timestamp, synthetic signed record). It contains no key.
The LatticeWorks/Mobi entrypoints exercise this shared protocol, not their absent or
shut production wiring. No HTS/NFT dry run is justified by the identified HCS day-1 scope.

Environment evidence for this run: no operator variables were provisioned; managed
HTTP policy excludes Hedera mirror/consensus hosts and grants no TCP destinations.
All live smoke invocations are BLOCKED, not testnet proof. Offline fake and real SDK
construction tests pass; behavioral mutations cover the safety gates independently.
