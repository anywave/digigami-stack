# HEDERA-DAY1-FIX JavaScript

Closes review F1 and F2 for the shared JavaScript layer and applies RADIX's later
alpha ruling: **testnet only**. There is no mainnet constructor, node list, mirror
URL or enabling flag in this layer. The fixed refusal is: "Day-1 alpha is testnet
only; mainnet is unavailable." A later mainnet release needs separate review and
a signer outside an agent account; these changes do not provide that release.

F1 uses two controls. Before each message preparation the mirror topic must match
its requested ID and expose `custom_fees.fixed_fees` as an empty array. Missing,
unreadable, malformed, unknown or nonempty schedules refuse before signing/sending.
Each signed message transaction also serializes one payer `CustomFeeLimit`, with
one zero HBAR `FixedFee` and no token denomination. This is separate from the
network transaction fee cap. Consensus rejects any positive HBAR custom fee and
any HTS denomination, including a schedule change after the mirror read. The
allowance is not added to topic creation, which does not support that limit.

The consensus rules were checked against pinned node source, not a live ledger:
[precheck permits zero, requires nonempty payer fees](https://github.com/hiero-ledger/hiero-consensus-node/blob/9efa5c465a49249e55235d560b4c8addad4a0182/hedera-node/hedera-app-spi/src/main/java/com/hedera/node/app/spi/validation/PreCheckValidator.java#L64),
and [payer denomination/amount checks](https://github.com/hiero-ledger/hiero-consensus-node/blob/9efa5c465a49249e55235d560b4c8addad4a0182/hedera-node/hedera-consensus-service-impl/src/main/java/com/hedera/node/app/service/consensus/impl/handlers/ConsensusSubmitMessageHandler.java#L387).
Actual SDK bytes are decoded in regressions for every prepared node alternative;
a fake consensus boundary exercises the corresponding HBAR/HTS race responses.

F2 removes mainnet authorization entirely and checks the actual `HEDERA_NETWORK`
before preparation, after asynchronous preparation, before every shared retry,
after SDK request signing, and immediately before raw gRPC `makeUnaryRequest`.
The last check follows asynchronous initialization/readiness and has no intervening
await before dispatch. SDK client/transaction/receipt attempts are one; the shared
wrapper owns retry counts. gRPC transparent retries are disabled. The per-client
channel has no global cache and retains the pinned SDK's TLS certificate handling.
These private hooks are specific to SDK 2.90.1 and gRPC 1.13.6 and require contract
regressions on upgrade. SDK helpers reject arbitrary unguarded clients. Official testnet targets are captured
in a private per-client snapshot; routing mutation and final channel target changes
refuse before raw RPC creation or dispatch. The shipping SDK facade exports only
`sdkLayer`; construction/transport helpers are internal test seams.

Validation: 35 tests pass, zero skipped; 38 behavioral mutations are killed. New
F1/F2 mutations require the named failing test plus assertion evidence; parser,
import, compile and timeout failures do not count. Real SDK transactions and
channels use a public fixture, fake signer and fake raw RPC only. Tests change
runtime network choice during prepare, SDK signing, channel initialization,
readiness and BUSY/retry paths and observe zero forbidden sends. No private test
key, operator credential, real RPC, account, ledger write or funding is used.

The direct gRPC pin makes the existing transitive transport dependency explicit.
All 87 installed dependency records/integrity values remain unchanged. The generated
lock is compacted one package per line; parsed content before/after formatting is
identical. Live testnet proof remains blocked by credentials/network provisioning.
