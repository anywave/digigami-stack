import { timingSafeEqual } from 'node:crypto';

export class HederaError extends Error {
  constructor(code) { super(code); this.name = 'HederaError'; this.code = code; }
}
const fail = code => { throw new HederaError(code); };
const networks = Object.freeze({
  testnet: 'https://testnet.mirrornode.hedera.com',
  mainnet: 'https://mainnet.mirrornode.hedera.com',
});
function integer(value, fallback, min, max) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) fail('INVALID_LIMIT');
  return n;
}
export function configuration(env = process.env) {
  const network = env.HEDERA_NETWORK ?? 'testnet';
  if (!Object.hasOwn(networks, network)) fail('INVALID_NETWORK');
  if (network === 'mainnet' && env.RADIX_HEDERA_MAINNET_ENABLED !== 'true') fail('MAINNET_DISABLED');
  // No endpoint override: credentials and mirror proofs stay on the chosen network.
  return Object.freeze({
    network, mirrorUrl: networks[network],
    maxFeeTinybars: integer(env.HEDERA_MAX_FEE_TINYBARS, 100_000_000, 1, 100_000_000),
    maxAttempts: integer(env.HEDERA_MAX_ATTEMPTS, 3, 1, 5),
    mirrorAttempts: integer(env.HEDERA_MIRROR_ATTEMPTS, 20, 1, 60),
    retryDelayMs: integer(env.HEDERA_RETRY_DELAY_MS, 1000, 1, 5000),
    timeoutMs: integer(env.HEDERA_TIMEOUT_MS, 10000, 100, 30000),
  });
}
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const transient = error => error?.retryable === true;
export async function retry(operation, attempts, delayMs, wait = sleep) {
  for (let n = 0; n < attempts; n++) {
    try { return await operation(); }
    catch (error) {
      if (!transient(error) || n === attempts - 1) fail('OPERATION_FAILED');
      await wait(Math.min(delayMs * (2 ** n), 5000));
    }
  }
  fail('OPERATION_FAILED');
}
export function equalBytes(actual, expected) {
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function parseMirrorMessage(value) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail('INVALID_MIRROR_MESSAGE');
  return Buffer.from(value, 'base64');
}
export class HederaLayer {
  #adapter; #config; #wait;
  constructor(config, adapter, wait = sleep) {
    // Revalidate even if a caller supplies a hand-built config object.
    const checked = configuration({
      HEDERA_NETWORK: config.network, HEDERA_MAX_FEE_TINYBARS: config.maxFeeTinybars,
      HEDERA_MAX_ATTEMPTS: config.maxAttempts, HEDERA_MIRROR_ATTEMPTS: config.mirrorAttempts,
      HEDERA_RETRY_DELAY_MS: config.retryDelayMs, HEDERA_TIMEOUT_MS: config.timeoutMs,
      RADIX_HEDERA_MAINNET_ENABLED: process.env.RADIX_HEDERA_MAINNET_ENABLED,
    });
    this.#config = checked; this.#adapter = adapter; this.#wait = wait;
  }
  async #poll(path, matches) {
    let found;
    for (let n = 0; n < this.#config.mirrorAttempts; n++) {
      try {
        found = await this.#adapter.mirror(path);
        if (matches(found)) return found;
        // An observed contradictory record is proof failure, never eventual success.
        if (found !== null) fail('MIRROR_MISMATCH');
      } catch (error) {
        if (!transient(error)) {
          if (error instanceof HederaError) throw error;
          fail('MIRROR_FAILED');
        }
      }
      if (n + 1 < this.#config.mirrorAttempts) await this.#wait(this.#config.retryDelayMs);
    }
    fail('MIRROR_TIMEOUT');
  }
  async #write(kind, fields) {
    if (this.#config.network === 'mainnet' && process.env.RADIX_HEDERA_MAINNET_ENABLED !== 'true') fail('MAINNET_DISABLED');
    // Prepare exactly once. Retries resend the same signed transaction ID/bytes.
    let transaction;
    try { transaction = await this.#adapter.prepare(kind, fields, this.#config.maxFeeTinybars); }
    catch { fail('PREPARE_FAILED'); }
    try { await retry(() => this.#adapter.execute(transaction), this.#config.maxAttempts, this.#config.retryDelayMs, this.#wait); }
    catch { /* An ambiguous send can still have reached consensus: reconcile the same ID. */ }
    let receipt;
    try { receipt = await retry(() => this.#adapter.receipt(transaction), this.#config.maxAttempts, this.#config.retryDelayMs, this.#wait); }
    catch { throw Object.assign(new HederaError('WRITE_UNCONFIRMED'), {transactionId: transaction.transactionId?.toString()}); }
    if (receipt.status !== 'SUCCESS') fail('RECEIPT_NOT_SUCCESS');
    return receipt;
  }
  async createTopic(memo) {
    if (typeof memo !== 'string' || Buffer.byteLength(memo) > 100) fail('INVALID_MEMO');
    const receipt = await this.#write('createTopic', {memo});
    if (!/^0\.0\.\d+$/.test(receipt.topicId ?? '')) fail('INVALID_TOPIC_RECEIPT');
    await this.#poll(`/api/v1/topics/${receipt.topicId}`, value => value?.topic_id === receipt.topicId
      && value.memo === memo && value.submit_key?.key === this.#adapter.publicKeyHex);
    return Object.freeze({topicId: receipt.topicId, transactionId: receipt.transactionId});
  }
  async submitRecord(topicId, record) {
    if (!/^0\.0\.\d+$/.test(topicId)) fail('INVALID_TOPIC');
    const bytes = Buffer.from(record);
    if (!bytes.length || bytes.length > 1024) fail('INVALID_RECORD_SIZE');
    const receipt = await this.#write('submitRecord', {topicId, bytes});
    const sequence = String(receipt.sequence ?? '');
    if (!/^[1-9]\d*$/.test(sequence)) fail('INVALID_MESSAGE_RECEIPT');
    const message = await this.#poll(`/api/v1/topics/${topicId}/messages/${sequence}`, value => value?.topic_id === topicId
      && String(value.sequence_number) === sequence && value.payer_account_id === this.#adapter.operatorId
      && equalBytes(parseMirrorMessage(value.message), bytes));
    return Object.freeze({topicId, sequence, transactionId: receipt.transactionId,
      consensusTimestamp: message.consensus_timestamp, bytes: Buffer.from(bytes)});
  }
  async signedRecord(record) {
    const unsigned = Buffer.from(JSON.stringify(record));
    const snapshot = JSON.parse(unsigned.toString());
    let signature;
    try { signature = await this.#adapter.sign(unsigned); } catch { fail('SIGN_FAILED'); }
    let verified;
    try { verified = await this.#adapter.verify(unsigned, signature); } catch { fail('SIGNATURE_INVALID'); }
    if (!verified) fail('SIGNATURE_INVALID');
    return Buffer.from(JSON.stringify({record: snapshot, publicKey: this.#adapter.publicKeyHex,
      signature: Buffer.from(signature).toString('base64')}));
  }
  close() { return this.#adapter.close?.(); }
}
