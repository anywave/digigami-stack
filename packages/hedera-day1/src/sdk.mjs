import { Client, Hbar, PrivateKey, AccountId, TopicCreateTransaction,
  TopicMessageSubmitTransaction, TransactionId, TransactionReceiptQuery, Logger, LogLevel, CustomFeeLimit, CustomFixedFee, MaxAttemptsOrTimeoutError } from '@hiero-ledger/sdk';
import { guardedChannel } from './transport.mjs';
import { ProxyAgent, fetch } from 'undici';
import { HederaError, configuration, HederaLayer, authorizeSend } from './index.mjs';

function safeFailure(error) {
  const status = error?.status?.toString?.() ?? '';
  const code = error?.code;
  // Only transport/retryable prechecks; every thrown public error has fixed text.
  const retryable = ['BUSY', 'PLATFORM_NOT_ACTIVE', 'PLATFORM_TRANSACTION_NOT_CREATED',
    'UNKNOWN', 'RECEIPT_NOT_FOUND'].includes(status) || [4, 8, 14].includes(code)
    || (error instanceof MaxAttemptsOrTimeoutError && /last error being: (BUSY|PLATFORM_NOT_ACTIVE|PLATFORM_TRANSACTION_NOT_CREATED|UNKNOWN|RECEIPT_NOT_FOUND)$/.test(error.message));
  return Object.assign(new HederaError('SDK_OPERATION_FAILED'), {retryable});
}
export function sdkLayer() {
  const config = configuration();
  // Secret values are read only here at run time and stay inside this closure.
  const operatorId = process.env.HEDERA_OPERATOR_ID;
  const encodedKey = process.env.HEDERA_OPERATOR_KEY;
  if (!operatorId || !encodedKey) throw new HederaError('OPERATOR_ENV_REQUIRED');
  let key, account;
  try { key = PrivateKey.fromStringDer(encodedKey); account = AccountId.fromString(operatorId); }
  catch { throw new HederaError('INVALID_OPERATOR_ENV'); }
  const client = makeClient(config);
  client.setLogger(new Logger({level: LogLevel.Error, silent: true}));
  client.setOperator(account, key).setDefaultMaxTransactionFee(Hbar.fromTinybars(config.maxFeeTinybars));
  client.setDefaultRegenerateTransactionId(false);
  client.setRequestTimeout(config.timeoutMs);
  const dispatcher = process.env.HTTPS_PROXY ? new ProxyAgent(process.env.HTTPS_PROXY) : undefined;
  const adapter = {
    operatorId: account.toString(), publicKeyHex: key.publicKey.toStringRaw(),
    async prepare(kind, fields, maxFeeTinybars) {
      return prepareSdkTransaction(config, client, key, account, kind, fields, maxFeeTinybars);
    },
    execute(tx) { return executeSdkTransaction(config, client, tx); },
    async receipt(tx) {
      try {
        const value = await new TransactionReceiptQuery().setTransactionId(tx.transactionId)
          .setValidateStatus(false).setMaxAttempts(1).execute(client);
        return {status: value.status.toString(), transactionId: tx.transactionId.toString(),
          topicId: value.topicId?.toString(), sequence: value.topicSequenceNumber?.toString()};
      } catch (error) { throw safeFailure(error); }
    },
    async mirror(path) {
      try {
        const response = await fetch(config.mirrorUrl + path, {dispatcher,
          signal: AbortSignal.timeout(config.timeoutMs), redirect: 'error'});
        if (response.status === 404) return null;
        if (!response.ok) throw Object.assign(new Error(), {retryable: response.status === 429 || response.status >= 500});
        return await response.json();
      } catch (error) {
        throw Object.assign(new HederaError('MIRROR_REQUEST_FAILED'),
          {retryable: error?.retryable === true || ['TimeoutError', 'AbortError'].includes(error?.name)});
      }
    },
    topicPolicy(topicId) { return adapter.mirror(`/api/v1/topics/${topicId}`); },
    sign(bytes) { return key.sign(bytes); },
    verify(bytes, signature) { return key.publicKey.verify(bytes, signature); },
    async close() { client.close(); await dispatcher?.close(); },
  };
  return new HederaLayer(config, adapter);
}

export function makeClient(config, factory, rpc) {
  if (config.network !== 'testnet') throw new HederaError('TESTNET_ONLY');
  if (factory !== undefined) throw new HederaError('TESTNET_ONLY');
  return new SendGuardedClient(config, rpc);
}
export async function prepareSdkTransaction(config, client, key, account, kind, fields, maxFeeTinybars) {
  authorizeSend(config); requireSafeClient(client);
  try {
    const tx = kind === 'createTopic'
      ? guardedTransaction(TopicCreateTransaction, config).setTopicMemo(fields.memo).setSubmitKey(key.publicKey)
      : guardedTransaction(TopicMessageSubmitTransaction, config).setTopicId(fields.topicId).setMessage(fields.bytes).setMaxChunks(1)
        .setCustomFeeLimits([new CustomFeeLimit({accountId: account, fees: [new CustomFixedFee({amount: 0})]})]);
    tx.setTransactionId(TransactionId.generate(account)).setRegenerateTransactionId(false)
      .setMaxTransactionFee(Hbar.fromTinybars(maxFeeTinybars));
    tx.setMaxAttempts(1);
    tx.freezeWith(client);
    await tx.sign(key);
    return tx;
  } catch { throw new HederaError('PREPARE_FAILED'); }
}

// Pinned SDK 2.90.1 invokes _execute only after async setup/request signing.
// Guard the synchronous handoff to its consensus channel, including any resend.
function guardedTransaction(Type, config) {
  return new class extends Type {
    _execute(channel, request) {
      try { authorizeSend(config); } catch (error) { return Promise.reject(error); }
      return super._execute(channel, request);
    }
  }();
}
export async function executeSdkTransaction(config, client, tx) {
  authorizeSend(config); requireSafeClient(client);
  try { await tx.execute(client); }
  catch (error) {
    if (error?.code === 'TESTNET_ONLY') throw error;
    if (error?.status?.toString?.() !== 'DUPLICATE_TRANSACTION') throw safeFailure(error);
  }
}

const testnetTargets = new WeakMap();
class SendGuardedClient extends Client {
  constructor(config, rpc) {
    super({network: 'testnet'}); testnetTargets.set(this, new Set(Object.keys(this.network)));
    this.sendConfig = config; this.rpc = rpc; this.setMaxAttempts(1);
  }
  setNetwork(network) {
    if (testnetTargets.has(this)) throw new HederaError('TESTNET_ONLY');
    return super.setNetwork(network);
  }
  _createNetworkChannel() {
    const create = super._createNetworkChannel();
    return address => guardedChannel(create(address), this.sendConfig, this.rpc, testnetTargets.get(this));
  }
}

function requireSafeClient(client) {
  const targets = testnetTargets.get(client); const addresses = Object.keys(client.network ?? {});
  if (!(client instanceof SendGuardedClient) || client.ledgerId?.toString() !== 'testnet'
    || !targets || addresses.length !== targets.size || addresses.some(address => !targets.has(address))) throw new HederaError('TESTNET_ONLY');
}
