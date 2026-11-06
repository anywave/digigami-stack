import test from 'node:test';
import assert from 'node:assert/strict';
import { configuration, HederaLayer, parseMirrorMessage, retry } from '../src/index.mjs';

const config = () => configuration({HEDERA_MIRROR_ATTEMPTS: '2', HEDERA_RETRY_DELAY_MS: '1'});
function fixture(overrides = {}) {
  const calls = {prepare: [], execute: [], receipt: [], mirror: []};
  const adapter = {
    operatorId: '0.0.123', publicKeyHex: 'public-key-fixture',
    prepare(kind, fields, fee) { const tx = {kind, fields, fee}; calls.prepare.push(tx); return tx; },
    execute(tx) { calls.execute.push(tx); },
    receipt(tx) { calls.receipt.push(tx); return {status: 'SUCCESS', topicId: '0.0.456', sequence: '7', transactionId: 'fixed-id'}; },
    mirror(path) {
      calls.mirror.push(path);
      if (path.endsWith('/messages/7')) return {topic_id: '0.0.456', sequence_number: 7,
        payer_account_id: '0.0.123', message: Buffer.from('record').toString('base64'), consensus_timestamp: '1.1'};
      return {topic_id: '0.0.456', memo: 'test', submit_key: {key: 'public-key-fixture'}};
    },
    sign() { return Buffer.from('synthetic-signature'); }, verify() { return true; },
    ...overrides,
  };
  return {layer: new HederaLayer(config(), adapter, async () => {}), calls, adapter};
}
const rejected = (promise, code) => assert.rejects(promise, {code});
test('network defaults to testnet and accepts only named networks', () => {
  assert.equal(configuration({}).network, 'testnet');
  assert.equal(configuration({}).mirrorUrl, 'https://testnet.mirrornode.hedera.com');
  for (const value of ['unknown', 'toString', 'constructor', '__proto__']) assert.throws(() => configuration({HEDERA_NETWORK: value}), {code: 'INVALID_NETWORK'});
});
test('mainnet requires explicit RADIX flag, constructor revalidates it', () => {
  assert.throws(() => configuration({HEDERA_NETWORK: 'mainnet'}), {code: 'MAINNET_DISABLED'});
  assert.throws(() => configuration({HEDERA_NETWORK: 'mainnet', RADIX_HEDERA_MAINNET_ENABLED: '1'}), {code: 'MAINNET_DISABLED'});
  const permitted = configuration({HEDERA_NETWORK: 'mainnet', RADIX_HEDERA_MAINNET_ENABLED: 'true'});
  assert.equal(permitted.network, 'mainnet');
  if (process.env.RADIX_HEDERA_MAINNET_ENABLED !== 'true') assert.throws(() => new HederaLayer(permitted, {}), {code: 'MAINNET_DISABLED'});
});
test('all limits are bounded, fee is passed on every write', async () => {
  for (const invalid of ['0', '-1', '100000001', 'NaN', '1.5']) assert.throws(() => configuration({HEDERA_MAX_FEE_TINYBARS: invalid}), {code: 'INVALID_LIMIT'});
  for (const [name, value] of [['HEDERA_MAX_ATTEMPTS','6'], ['HEDERA_MIRROR_ATTEMPTS','61'], ['HEDERA_TIMEOUT_MS','99']]) assert.throws(() => configuration({[name]:value}), {code: 'INVALID_LIMIT'});
  const {layer, calls} = fixture();
  await layer.createTopic('test'); await layer.submitRecord('0.0.456', Buffer.from('record'));
  assert.deepEqual(calls.prepare.map(t => t.fee), [100_000_000, 100_000_000]);
});
test('fake smoke creates keyed topic, signs record and verifies exact mirror bytes', async () => {
  const {layer, calls} = fixture();
  const record = await layer.signedRecord({synthetic: true});
  const envelope = JSON.parse(record);
  assert.equal(envelope.publicKey, 'public-key-fixture');
  assert.equal(envelope.signature, Buffer.from('synthetic-signature').toString('base64'));
  const topic = await layer.createTopic('test');
  const result = await layer.submitRecord(topic.topicId, Buffer.from('record'));
  assert.deepEqual(result.bytes, Buffer.from('record'));
  assert.deepEqual(calls.mirror, ['/api/v1/topics/0.0.456','/api/v1/topics/0.0.456/messages/7']);
});
test('signature failure cannot produce a signed record', async () => {
  await rejected(fixture({verify: () => false}).layer.signedRecord({synthetic: true}), 'SIGNATURE_INVALID');
});
test('non-success receipt prevents mirror access for topic and message', async () => {
  const {layer, calls} = fixture({receipt: () => ({status: 'INVALID_SIGNATURE'})});
  await rejected(layer.createTopic('test'), 'RECEIPT_NOT_SUCCESS');
  await rejected(layer.submitRecord('0.0.456', Buffer.from('record')), 'RECEIPT_NOT_SUCCESS');
  assert.equal(calls.mirror.length, 0);
});
test('retry resends identical prepared object, bounded exhaustion, permanent rejection', async () => {
  let count = 0;
  const f = fixture({execute(tx) { f.calls.execute.push(tx); if (++count < 3) throw {retryable: true}; }});
  await f.layer.createTopic('test');
  assert.equal(f.calls.prepare.length, 1); assert.equal(f.calls.execute.length, 3);
  assert.equal(new Set(f.calls.execute).size, 1);
  let attempts = 0;
  await rejected(retry(() => { attempts++; throw {retryable: true}; }, 3, 1, async () => {}), 'OPERATION_FAILED');
  assert.equal(attempts, 3);
  attempts = 0;
  await rejected(retry(() => { attempts++; throw Error('sensitive diagnostics'); }, 3, 1, async () => {}), 'OPERATION_FAILED');
  assert.equal(attempts, 1);
});
test('mirror eventual consistency retries, missing proof fails closed', async () => {
  const f = fixture(); const mirror = f.adapter.mirror; let n = 0;
  f.adapter.mirror = path => ++n === 1 ? null : mirror(path);
  await f.layer.createTopic('test'); assert.equal(n, 2);
  await rejected(fixture({mirror: () => null}).layer.createTopic('test'), 'MIRROR_TIMEOUT');
  await rejected(fixture({mirror: () => null}).layer.submitRecord('0.0.456', Buffer.from('record')), 'MIRROR_TIMEOUT');
});
test('topic proof pins topic, memo and submit key', async () => {
  const good = {topic_id: '0.0.456', memo: 'test', submit_key: {key: 'public-key-fixture'}};
  for (const replacement of [{topic_id:'0.0.999'}, {memo:'other'}, {submit_key:{key:'other-public-key'}}]) {
    await rejected(fixture({mirror: () => ({...good,...replacement})}).layer.createTopic('test'), 'MIRROR_MISMATCH');
  }
});
test('message proof pins topic, sequence, payer and every byte', async () => {
  const good = {topic_id: '0.0.456', sequence_number:7, payer_account_id:'0.0.123',message:Buffer.from('record').toString('base64')};
  for (const replacement of [{topic_id:'0.0.999'}, {sequence_number:8}, {payer_account_id:'0.0.999'}, {message:Buffer.from('recorD').toString('base64')}]) {
    await rejected(fixture({mirror: () => ({...good,...replacement})}).layer.submitRecord('0.0.456', Buffer.from('record')), 'MIRROR_MISMATCH');
  }
  assert.throws(() => parseMirrorMessage('%%%'), {code:'INVALID_MIRROR_MESSAGE'});
});
test('invalid receipts, topics and oversized record fail closed', async () => {
  await rejected(fixture({receipt: () => ({status:'SUCCESS',topicId:'bad'})}).layer.createTopic('test'), 'INVALID_TOPIC_RECEIPT');
  await rejected(fixture({receipt: () => ({status:'SUCCESS',sequence:'0'})}).layer.submitRecord('0.0.456',Buffer.from('record')), 'INVALID_MESSAGE_RECEIPT');
  const {layer,calls} = fixture();
  await rejected(layer.submitRecord('https://other',Buffer.from('record')), 'INVALID_TOPIC');
  await rejected(layer.submitRecord('0.0.456',Buffer.alloc(1025)), 'INVALID_RECORD_SIZE');
  assert.equal(calls.prepare.length,0);
});

test('adapter diagnostics are redacted on prepare, sign and verify failure', async () => {
  const sensitive = () => { throw Error('must-not-escape'); };
  await rejected(fixture({prepare: sensitive}).layer.createTopic('test'), 'PREPARE_FAILED');
  await rejected(fixture({sign: sensitive}).layer.signedRecord({}), 'SIGN_FAILED');
  await rejected(fixture({verify: sensitive}).layer.signedRecord({}), 'SIGNATURE_INVALID');
});

test('signed payload is snapshotted before async signing', async () => {
  const record = {value:'original'};
  const {layer} = fixture({sign() { record.value = 'mutated'; return Buffer.from('synthetic-signature'); }});
  assert.equal(JSON.parse(await layer.signedRecord(record)).record.value, 'original');
});

test('ambiguous send reconciles same transaction receipt and mirror', async () => {
  const f = fixture({execute(tx) { f.calls.execute.push(tx); throw {retryable:true}; }});
  await f.layer.createTopic('test');
  assert.equal(f.calls.prepare.length,1); assert.equal(f.calls.execute.length,3);
  assert.equal(f.calls.receipt.length,1); assert.equal(f.calls.mirror.length,1);
});

test('revoked RADIX mainnet switch refuses writes before prepare', async () => {
  const previous = process.env.RADIX_HEDERA_MAINNET_ENABLED; const f = fixture();
  try {
    process.env.RADIX_HEDERA_MAINNET_ENABLED = 'true';
    const layer = new HederaLayer(configuration({HEDERA_NETWORK:'mainnet',RADIX_HEDERA_MAINNET_ENABLED:'true'}),f.adapter);
    delete process.env.RADIX_HEDERA_MAINNET_ENABLED;
    await rejected(layer.createTopic('test'),'MAINNET_DISABLED');
    await rejected(layer.submitRecord('0.0.456',Buffer.from('record')),'MAINNET_DISABLED');
    assert.equal(f.calls.prepare.length,0);
  } finally { if (previous === undefined) delete process.env.RADIX_HEDERA_MAINNET_ENABLED; else process.env.RADIX_HEDERA_MAINNET_ENABLED = previous; }
});
