import { timingSafeEqual } from 'node:crypto';

export class HederaError extends Error {
  constructor(code) { super(code === 'TESTNET_ONLY' ? 'Day-1 alpha is testnet only; mainnet is unavailable.' : code); this.name = 'HederaError'; this.code = code; }
}
const fail = code => { throw new HederaError(code); };
const endpointVariables = ['HEDERA_NODE_URL', 'HEDERA_MIRROR_URL', 'HEDERA_MIRROR_NODE_URL', 'HEDERA_GRPC_ENDPOINT'];
export function authorizeSend(config) {
  if (config.network !== 'testnet' || (process.env.HEDERA_NETWORK ?? 'testnet') !== 'testnet'
    || endpointVariables.some(name => process.env[name] !== undefined)) fail('TESTNET_ONLY');
}
function integer(value, fallback, min, max) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) fail('INVALID_LIMIT');
  return n;
}
export function configuration(env = process.env) {
  const network = env.HEDERA_NETWORK ?? 'testnet';
  if (network !== 'testnet') fail('TESTNET_ONLY');
  if (endpointVariables.some(name => env[name] !== undefined)) fail('TESTNET_ONLY');
  // No endpoint override: credentials and mirror proofs stay on the chosen network.
  return Object.freeze({
    network, mirrorUrl: 'https://testnet.mirrornode.hedera.com',
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
      if (error?.code === 'TESTNET_ONLY') throw error;
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
export function topicKeyRequest(publicKeyHex, publicKeyType) {
  const sizes = {ED25519: 64, ECDSA_SECP256K1: 66};
  if (!Object.hasOwn(sizes, publicKeyType) || typeof publicKeyHex !== 'string'
    || publicKeyHex.length !== sizes[publicKeyType] || !/^[0-9a-f]+$/.test(publicKeyHex)) fail('INVALID_TOPIC_KEYS');
  return Object.freeze({admin: null, submit: Object.freeze({_type: publicKeyType, key: publicKeyHex})});
}
function mirrorKeyMatches(actual, expected) {
  if (expected === null) return actual === null;
  return actual !== null && typeof actual === 'object' && !Array.isArray(actual)
    && Object.keys(actual).length === 2 && Object.hasOwn(actual, '_type') && Object.hasOwn(actual, 'key')
    && actual._type === expected._type && actual.key === expected.key;
}
export class HederaLayer {
  #adapter; #config; #wait;
  constructor(config, adapter, wait = sleep) {
    // Revalidate even if a caller supplies a hand-built config object.
    const checked = configuration({
      HEDERA_NETWORK: config.network, HEDERA_MAX_FEE_TINYBARS: config.maxFeeTinybars,
      HEDERA_MAX_ATTEMPTS: config.maxAttempts, HEDERA_MIRROR_ATTEMPTS: config.mirrorAttempts,
      HEDERA_RETRY_DELAY_MS: config.retryDelayMs, HEDERA_TIMEOUT_MS: config.timeoutMs,
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
    authorizeSend(this.#config);
    // Prepare exactly once. Retries resend the same signed transaction ID/bytes.
    let transaction;
    try { transaction = await this.#adapter.prepare(kind, fields, this.#config.maxFeeTinybars); }
    catch { fail('PREPARE_FAILED'); }
    try { await retry(() => { authorizeSend(this.#config); return this.#adapter.execute(transaction); }, this.#config.maxAttempts, this.#config.retryDelayMs, this.#wait); }
    catch (error) {
      if (error?.code === 'TESTNET_ONLY') throw error;
      // An ambiguous send can still have reached consensus: reconcile the same ID.
    }
    let receipt;
    try { receipt = await retry(() => this.#adapter.receipt(transaction), this.#config.maxAttempts, this.#config.retryDelayMs, this.#wait); }
    catch { throw Object.assign(new HederaError('WRITE_UNCONFIRMED'), {transactionId: transaction.transactionId?.toString()}); }
    if (receipt.status !== 'SUCCESS') fail('RECEIPT_NOT_SUCCESS');
    return receipt;
  }
  async createTopic(memo) {
    if (typeof memo !== 'string' || Buffer.byteLength(memo) > 100) fail('INVALID_MEMO');
    const requestedKeys = topicKeyRequest(this.#adapter.publicKeyHex, this.#adapter.publicKeyType);
    const receipt = await this.#write('createTopic', {memo, topicKeys: requestedKeys});
    if (!/^0\.0\.\d+$/.test(receipt.topicId ?? '')) fail('INVALID_TOPIC_RECEIPT');
    await this.#poll(`/api/v1/topics/${receipt.topicId}`, value => value?.topic_id === receipt.topicId
      && value.memo === memo && Object.hasOwn(value, 'admin_key') && Object.hasOwn(value, 'submit_key')
      && mirrorKeyMatches(value.admin_key, requestedKeys.admin)
      && mirrorKeyMatches(value.submit_key, requestedKeys.submit));
    return Object.freeze({topicId: receipt.topicId, transactionId: receipt.transactionId});
  }
  async submitRecord(topicId, record) {
    if (!/^0\.0\.\d+$/.test(topicId)) fail('INVALID_TOPIC');
    const bytes = Buffer.from(record);
    if (!bytes.length || bytes.length > 1024) fail('INVALID_RECORD_SIZE');
    let topic;
    try { topic = await this.#adapter.topicPolicy(topicId); } catch { fail('TOPIC_FEE_POLICY_UNREADABLE'); }
    if (topic?.topic_id !== topicId || !topic.custom_fees || Array.isArray(topic.custom_fees)
      || Object.keys(topic.custom_fees).some(key => !['created_timestamp', 'fixed_fees'].includes(key))
      || (Object.hasOwn(topic.custom_fees, 'created_timestamp')
        && (typeof topic.custom_fees.created_timestamp !== 'string' || !/^\d{1,10}(\.\d{1,9})?$/.test(topic.custom_fees.created_timestamp)))
      || !Array.isArray(topic.custom_fees.fixed_fees)
      || topic.custom_fees.fixed_fees.length !== 0) fail('TOPIC_CUSTOM_FEES_FORBIDDEN');
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
