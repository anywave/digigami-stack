# HEDERA-DAY1-FIX-2 JavaScript

Corrects F4-R from `R-HEDERA-DAY1-2-001` against the previous JavaScript head
`a297f018be71cb3ce467b0fbfe2b48cbe67a1a33`. Topic creation now captures immutable
requested security metadata before asynchronous preparation: no admin key and the
operator's typed submit key. The SDK builder checks declared metadata against its
actual request. Mirror confirmation compares both requested key states.

An absent requested admin requires an own `admin_key: null` field in decoded
mirror JSON. Missing/undefined, malformed or unexpected admin evidence refuses
confirmation. The submit evidence must contain exactly its own `_type` and `key`
fields and match the requested algorithm and public key exactly. Explicit null,
missing fields, wrong types/keys and malformed or extended objects refuse.

The regression follows the shared create API through real SDK preparation and
signed transaction decoding, then returns fake mirror JSON derived from that
same wire. It checks every prepared node alternative, ED25519/ECDSA positive cases
and all 70 admin/submit combinations. Only explicit absent admin plus the exact
submit state passes. It also checks frozen expectations across async preparation
and refuses metadata that contradicts the SDK builder's actual requested states.

Validation: 39 tests pass, zero skipped; all 45 behavioral mutations are killed.
Removing the admin comparison fails the named paired-wire/mirror matrix assertion;
submit/type/bytes/shape, requested admin absence and immutable-state removal controls
also fail their intended assertions. Existing testnet-only routing, runtime send,
retry/receipt, zero custom-fee and byte-readback controls still pass.

Dependencies are unchanged; no reinstall was needed. Tests use public fixtures,
a fake signer and fake execute/mirror boundaries. No private signing key, operator
credential, real RPC, account, funding or ledger write is used. This establishes
offline wire/policy behavior; live testnet and product-wiring limitations remain.
