import { Client, Hbar, PrivateKey, AccountId, TopicCreateTransaction,
  TopicMessageSubmitTransaction, TransactionId, TransactionReceiptQuery, Logger, LogLevel } from '@hiero-ledger/sdk';
import { ProxyAgent, fetch } from 'undici';
import { HederaError, configuration, HederaLayer } from './index.mjs';

function safeFailure(error) {
  const status = error?.status?.toString?.() ?? '';
  const code = error?.code;
  // Only transport/retryable prechecks; every thrown public error has fixed text.
  const retryable = ['BUSY', 'PLATFORM_NOT_ACTIVE', 'PLATFORM_TRANSACTION_NOT_CREATED',
    'UNKNOWN', 'RECEIPT_NOT_FOUND'].includes(status) || [4, 8, 14].includes(code);
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
  client.setMaxAttempts(config.maxAttempts).setRequestTimeout(config.timeoutMs);
  const dispatcher = process.env.HTTPS_PROXY ? new ProxyAgent(process.env.HTTPS_PROXY) : undefined;
  const adapter = {
    operatorId: account.toString(), publicKeyHex: key.publicKey.toStringRaw(),
    async prepare(kind, fields, maxFeeTinybars) {
      return prepareSdkTransaction(config, client, key, account, kind, fields, maxFeeTinybars);
    },
    async execute(tx) {
      try { await tx.execute(client); }
      catch (error) {
        // A retry of an accepted ID may return DUPLICATE_TRANSACTION: check its receipt.
        if (error?.status?.toString?.() !== 'DUPLICATE_TRANSACTION') throw safeFailure(error);
      }
    },
    async receipt(tx) {
      try {
        const value = await new TransactionReceiptQuery().setTransactionId(tx.transactionId)
          .setValidateStatus(false).setMaxAttempts(config.maxAttempts).execute(client);
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
    sign(bytes) { return key.sign(bytes); },
    verify(bytes, signature) { return key.publicKey.verify(bytes, signature); },
    async close() { client.close(); await dispatcher?.close(); },
  };
  return new HederaLayer(config, adapter);
}

export function makeClient(config, factory = Client) {
  switch (config.network) {
    case 'testnet': return factory.forTestnet();
    case 'mainnet':
      if (process.env.RADIX_HEDERA_MAINNET_ENABLED !== 'true') throw new HederaError('MAINNET_DISABLED');
      return factory.forMainnet();
    default: throw new HederaError('INVALID_NETWORK');
  }
}
export async function prepareSdkTransaction(config, client, key, account, kind, fields, maxFeeTinybars) {
  try {
        const tx = kind === 'createTopic'
          ? new TopicCreateTransaction().setTopicMemo(fields.memo).setSubmitKey(key.publicKey)
          : new TopicMessageSubmitTransaction().setTopicId(fields.topicId).setMessage(fields.bytes).setMaxChunks(1);
        tx.setTransactionId(TransactionId.generate(account)).setRegenerateTransactionId(false)
          .setMaxTransactionFee(Hbar.fromTinybars(maxFeeTinybars));
        tx.setMaxAttempts(config.maxAttempts);
        tx.freezeWith(client);
        await tx.sign(key);
        return tx;
      } catch { throw new HederaError('PREPARE_FAILED'); }
}
