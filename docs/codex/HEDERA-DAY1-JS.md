# HEDERA-DAY1 JavaScript validation

Private implementation branch: `codex/HEDERA-DAY1-js`; source starts at
`packages/hedera-day1/src/index.mjs`, official adapter at `src/sdk.mjs` under that package.
SDK: `@hiero-ledger/sdk` 2.90.1, Apache-2.0, verified from live registry and upstream.
One shared package serves Node lab/server consumers. It is not bundled into Rust
applications or the extension. Existing `extension/options.js` hederaAnchor=false
and the simplified SPIRAL verification stub remain unwired; these need product work.

Validation completed: `npm test` passes 35 tests (15 fake-layer, 3 offline SDK and 17 fix regressions).
`npm run test:mutations` kills 38/38 safety mutations. The harness checks syntax first,
then requires an assertion failure; syntax/import errors/timeouts do not count.
Tests cover testnet-only config and runtime network changes, runtime-only credentials, caps, retry identity,
receipts, both mirror write proofs, payer/key pins, exact bytes and record signatures.
A real SDK object is built offline with a public fixture and fake signer, with no
private test key material. Ambiguous send reconciliation uses the same receipt/ID.

All six named smoke products were invoked: Digigami, Digigami Audit, auction integrity,
LatticeWorks, token auditor and Mobi Connect. They exit 1 with the fixed code
THROWAWAY_TESTNET_ACCOUNT_REQUIRED. With that opt-in, absence of runtime credentials
returns OPERATOR_ENV_REQUIRED. Mainnet is unavailable even with an obsolete enabling flag; refusal includes
a fixed human-readable message. No ledger calls or writes occurred. Managed policy excludes
Hedera hosts and has no TCP destinations. Testnet proof remains BLOCKED.
No HTS/NFT day-1 need was identified. No funding, accounts, payouts or tokens were made.

F1/F2 corrections and immutable protocol references: see `HEDERA-DAY1-FIX-JS.md`.
