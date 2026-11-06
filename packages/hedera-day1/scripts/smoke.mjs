import { randomUUID } from 'node:crypto';
import { sdkLayer } from '../src/sdk.mjs';
import { HederaError, configuration, equalBytes } from '../src/index.mjs';

const products = new Set(['digigami', 'digigami-audit', 'hedera-auction-integrity',
  'latticeworks', 'token-auditor', 'mobi-connect']);
let layer;
try {
  const product = process.argv[2];
  if (!products.has(product)) throw new HederaError('INVALID_PRODUCT');
  if (configuration().network !== 'testnet') throw new HederaError('SMOKE_TESTNET_ONLY');
  if (process.env.HEDERA_TESTNET_THROWAWAY !== 'true') throw new HederaError('THROWAWAY_TESTNET_ACCOUNT_REQUIRED');
  layer = sdkLayer();
  const runId = randomUUID();
  const record = await layer.signedRecord({schema: 'hedera-day1-smoke-v1', product, runId,
    payload: 'synthetic-test-record'});
  const topic = await layer.createTopic(`day1:${product}:${runId}`);
  const result = await layer.submitRecord(topic.topicId, record);
  if (!equalBytes(record, result.bytes)) throw new HederaError('BYTE_COMPARISON_FAILED');
  console.log(JSON.stringify({status: 'PASS', network: 'testnet', product, topicId: result.topicId,
    sequence: result.sequence, transactionId: result.transactionId,
    consensusTimestamp: result.consensusTimestamp, recordBase64: record.toString('base64')}));
} catch (error) {
  // Do not stringify SDK errors: SDK diagnostic objects may contain signing state.
  console.error(JSON.stringify({status: 'BLOCKED_OR_FAILED', code: error instanceof HederaError ? error.code : 'SMOKE_FAILED'}));
  process.exitCode = 1;
} finally { await layer?.close(); }
