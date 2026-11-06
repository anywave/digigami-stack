import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountId, PublicKey } from '@hiero-ledger/sdk';
import { proto } from '@hiero-ledger/proto';
import { configuration, HederaLayer } from '../src/index.mjs';
import { makeClient, prepareSdkTransaction, executeSdkTransaction } from '../src/sdk.mjs';

function fakeLayer({network = 'testnet', prepare, wait, policy} = {}) {
  const calls = {prepare:0, sends:[], policy:0};
  const adapter = {
    operatorId:'0.0.123', publicKeyHex:'01'.repeat(32), publicKeyType:'ED25519',
    prepare: async () => { calls.prepare++; await prepare?.(); return {sameId:true}; },
    execute: () => { calls.sends.push((process.env.HEDERA_NETWORK ?? 'testnet') === 'testnet'); if (wait) throw {retryable:true}; },
    receipt: () => ({status:'SUCCESS',topicId:'0.0.456',sequence:'1'}),
    mirror: () => ({topic_id:'0.0.456',memo:'test',admin_key:null,submit_key:{_type:'ED25519',key:'01'.repeat(32)},sequence_number:1,payer_account_id:'0.0.123',message:Buffer.from('test').toString('base64')}),
    topicPolicy: () => { calls.policy++; return policy ? policy() : {topic_id:'0.0.456',custom_fees:{fixed_fees:[]}}; },
  };
  const layer = new HederaLayer(configuration({HEDERA_NETWORK:network}), adapter, wait ?? (async () => {}));
  return {layer,calls};
}
async function withTestnetNetwork(body) {
  const before = process.env.HEDERA_NETWORK;
  try { process.env.HEDERA_NETWORK = 'testnet'; await body(); }
  finally { if (before === undefined) delete process.env.HEDERA_NETWORK; else process.env.HEDERA_NETWORK = before; }
}
test('F1 topic fee preflight rejects nonzero HBAR and HTS before preparation', async () => {
  for (const fee of [{amount:1,denominating_token_id:null},{amount:1,denominating_token_id:'0.0.999'}]) {
    const f = fakeLayer({policy:() => ({topic_id:'0.0.456',custom_fees:{fixed_fees:[fee]}})});
    await assert.rejects(f.layer.submitRecord('0.0.456',Buffer.from('test')),{code:'TOPIC_CUSTOM_FEES_FORBIDDEN'});
    assert.equal(f.calls.prepare,0); assert.equal(f.calls.sends.length,0);
  }
});
test('F1 unreadable missing malformed or unknown fee schedules refuse all sends', async () => {
  for (const value of [null,{}, {topic_id:'0.0.999',custom_fees:{fixed_fees:[]}},
    {topic_id:'0.0.456',custom_fees:{}},{topic_id:'0.0.456',custom_fees:null},{topic_id:'0.0.456',custom_fees:[]},
    {topic_id:'0.0.456',custom_fees:{fixed_fees:{}}},
    ...[null,{},'bad'].map(created_timestamp => ({topic_id:'0.0.456',custom_fees:{fixed_fees:[],created_timestamp}})),
    {topic_id:'0.0.456',custom_fees:{fixed_fees:[],unknown_fees:[{amount:1}]}}]) {
    const f = fakeLayer({policy:() => value});
    await assert.rejects(f.layer.submitRecord('0.0.456',Buffer.from('test')),{code:'TOPIC_CUSTOM_FEES_FORBIDDEN'});
    assert.equal(f.calls.sends.length,0);
  }
  const f = fakeLayer({policy:() => { throw Error('unreadable'); }});
  await assert.rejects(f.layer.submitRecord('0.0.456',Buffer.from('test')),{code:'TOPIC_FEE_POLICY_UNREADABLE'});
  assert.equal(f.calls.prepare,0);
});
test('F1 every message submission reads zero-fee policy before prepare', async () => {
  const f = fakeLayer(); await f.layer.submitRecord('0.0.456',Buffer.from('test'));
  await f.layer.submitRecord('0.0.456',Buffer.from('test')); assert.equal(f.calls.policy,2);
});
test('F2 network change during delayed prepare prevents first shared send', async () => withTestnetNetwork(async () => {
  const f = fakeLayer({network:'testnet',prepare:async () => { await Promise.resolve(); process.env.HEDERA_NETWORK = 'mainnet'; }});
  await assert.rejects(f.layer.createTopic('test'),{code:'TESTNET_ONLY'}); assert.equal(f.calls.sends.length,0);
}));
test('F2 network change during retry delay prevents shared resend', async () => withTestnetNetwork(async () => {
  const f = fakeLayer({network:'testnet',wait:async () => { process.env.HEDERA_NETWORK = 'mainnet'; }});
  await assert.rejects(f.layer.createTopic('test'),{code:'TESTNET_ONLY'}); assert.deepEqual(f.calls.sends,[true]);
}));
const account = AccountId.fromString('0.0.123');
const key = {publicKey:PublicKey.fromStringED25519('01'.repeat(32)), sign:() => new Uint8Array(64)};
function rpcFixture({busy = false, revokeDuring, assessedFee, config = configuration({})} = {}) {
  const calls = {options:[], flags:[], bodies:[]};
  const rpc = {credentials:{createInsecure:() => ({}), createSsl:() => ({})}, Client:class {
    constructor(address,credentials,options) { calls.options.push(options); if (revokeDuring === 'initialize') queueMicrotask(() => { process.env.HEDERA_NETWORK = 'mainnet'; }); }
    waitForReady(deadline,done) { queueMicrotask(() => { if (revokeDuring === 'ready') process.env.HEDERA_NETWORK = 'mainnet'; if (revokeDuring === 'endpoint') process.env.HEDERA_NODE_URL = 'https://mainnet.mirrornode.hedera.com'; done(); }); }
    makeUnaryRequest(method,serialize,deserialize,bytes,metadata,done) {
      calls.flags.push((process.env.HEDERA_NETWORK ?? 'testnet') === 'testnet');
      const tx = proto.Transaction.decode(bytes); const signed = proto.SignedTransaction.decode(tx.signedTransactionBytes);
      const body = proto.TransactionBody.decode(signed.bodyBytes); calls.bodies.push(body);
      let code = busy ? proto.ResponseCodeEnum.BUSY : proto.ResponseCodeEnum.OK;
      if (assessedFee && body.maxCustomFees.length) {
        const limit = body.maxCustomFees.find(value => value.accountId?.accountNum?.toString() === '123');
        const allowed = limit?.fees.find(value => assessedFee === 'HBAR' ? !value.denominatingTokenId : value.denominatingTokenId?.tokenNum?.toString() === '999');
        if (!allowed) code = proto.ResponseCodeEnum.NO_VALID_MAX_CUSTOM_FEE;
        else if (BigInt(allowed.amount.toString()) < 1n) code = proto.ResponseCodeEnum.MAX_CUSTOM_FEE_LIMIT_EXCEEDED;
      }
      if (revokeDuring === 'busy') process.env.HEDERA_NETWORK = 'mainnet';
      done(null,proto.TransactionResponse.encode({nodeTransactionPrecheckCode:code}).finish());
    }
    close() {}
  }};
  return {client:makeClient(config,undefined,rpc),calls,config};
}
function message(config,client) { return prepareSdkTransaction(config,client,key,account,'submitRecord',{topicId:'0.0.456',bytes:Buffer.from('test')},12345); }
test('F1 actual SDK wire has payer zero HBAR cap and no allowed HTS denominations', async () => {
  const f = rpcFixture();
  try {
    const create = await prepareSdkTransaction(f.config,f.client,key,account,'createTopic',{memo:'test'},12345);
    for (const item of proto.TransactionList.decode(create.toBytes()).transactionList)
      assert.equal(proto.TransactionBody.decode(proto.SignedTransaction.decode(item.signedTransactionBytes).bodyBytes).maxCustomFees.length,0);
    const tx = await message(f.config,f.client);
    const wire = proto.TransactionList.decode(tx.toBytes()); assert.ok(wire.transactionList.length > 0);
    for (const item of wire.transactionList) {
      const body = proto.TransactionBody.decode(proto.SignedTransaction.decode(item.signedTransactionBytes).bodyBytes);
      assert.equal(body.transactionFee.toString(),'12345'); assert.equal(body.maxCustomFees.length,1);
      const limit = body.maxCustomFees[0]; assert.equal(limit.accountId?.accountNum?.toString(),'123');
      assert.equal(limit.fees.length,1); assert.equal(limit.fees[0].amount.toString(),'0');
      assert.equal(limit.fees[0].denominatingTokenId,null);
    }
  } finally { f.client.close(); }
});
test('F2 real SDK has one consensus attempt and gRPC hidden retries disabled', async () => {
  const f = rpcFixture({busy:true});
  try {
    const tx = await message(f.config,f.client);
    await assert.rejects(executeSdkTransaction(f.config,f.client,tx),{code:'SDK_OPERATION_FAILED',retryable:true});
    assert.equal(tx.maxAttempts,1); assert.equal(f.client.maxAttempts,1); assert.equal(f.calls.flags.length,1);
    assert.ok(f.calls.options.length > 0); assert.ok(f.calls.options.every(options => options['grpc.enable_retries'] === 0));
  } finally { f.client.close(); }
});
for (const phase of ['initialize','ready']) test(`F2 actual SDK ${phase} network change blocks concrete gRPC send`, async () => withTestnetNetwork(async () => {
  const config = configuration({});
  const f = rpcFixture({revokeDuring:phase,config});
  try {
    const tx = await message(config,f.client);
    await assert.rejects(executeSdkTransaction(config,f.client,tx),{code:'TESTNET_ONLY'});
    assert.deepEqual(f.calls.flags,[]); assert.equal(f.calls.bodies.length,0);
  } finally { f.client.close(); }
}));
test('F2 actual SDK request-signing network change blocks before RPC acquisition', async () => withTestnetNetwork(async () => {
  const config = configuration({}); const f = rpcFixture({config});
  try {
    const tx = await message(config,f.client); const makeRequest = tx._makeRequestAsync.bind(tx);
    tx._makeRequestAsync = async () => { const request = await makeRequest(); process.env.HEDERA_NETWORK = 'mainnet'; return request; };
    await assert.rejects(executeSdkTransaction(config,f.client,tx),{code:'TESTNET_ONLY'});
    assert.deepEqual(f.calls.flags,[]); assert.equal(f.calls.options.length,0);
  } finally { f.client.close(); }
}));

test('F1 consensus fixture rejects fee-schedule race in HBAR and unknown HTS', async () => {
  for (const assessedFee of ['HBAR','HTS']) {
    const f = rpcFixture({assessedFee});
    try { await assert.rejects(executeSdkTransaction(f.config,f.client,await message(f.config,f.client)),{code:'SDK_OPERATION_FAILED',retryable:false}); assert.equal(f.calls.bodies.length,1); }
    finally { f.client.close(); }
  }
});
test('F2 actual SDK BUSY network change prevents concrete RPC resend', async () => withTestnetNetwork(async () => {
  const config = configuration({});
  const f = rpcFixture({config,busy:true,revokeDuring:'busy'});
  const layer = new HederaLayer(config,{
    publicKeyHex:key.publicKey.toStringRaw(),publicKeyType:'ED25519',
    prepare:() => prepareSdkTransaction(config,f.client,key,account,'createTopic',{memo:'test'},12345),
    execute:tx => executeSdkTransaction(config,f.client,tx),
    receipt:() => { assert.fail('network change must not be swallowed into receipt reconciliation'); },
  },async () => {});
  try { await assert.rejects(layer.createTopic('test'),{code:'TESTNET_ONLY'}); assert.deepEqual(f.calls.flags,[true]); }
  finally { f.client.close(); }
}));

test('alpha SDK helpers refuse arbitrary unguarded clients', async () => {
  const config = configuration({}); const unguarded = {ledgerId:{toString:() => 'testnet'}};
  await assert.rejects(prepareSdkTransaction(config,unguarded,key,account,'createTopic',{memo:'test'},12345),{code:'TESTNET_ONLY'});
  await assert.rejects(executeSdkTransaction(config,unguarded,{execute() { assert.fail('unguarded client must never execute'); }}),{code:'TESTNET_ONLY'});
});

test('alpha rejects SDK endpoint mutations and arbitrary channel targets', async () => {
  const f = rpcFixture();
  try {
    assert.throws(() => f.client.setNetwork({'mainnet-node00-00-grpc.hedera.com:50211':account}),{code:'TESTNET_ONLY'});
    const channel = f.client._createNetworkChannel()('mainnet-node00-00-grpc.hedera.com:50211');
    await assert.rejects(channel.consensus.submitMessage({}),{code:'TESTNET_ONLY'});
    assert.equal(f.calls.options.length,0); assert.equal(f.calls.flags.length,0);
    const prepared = await message(f.config,f.client);
    for (const node of f.client._network._nodes) node.getChannel().address = 'mainnet-node00-00-grpc.hedera.com:50211';
    await assert.rejects(executeSdkTransaction(f.config,f.client,prepared),{code:'TESTNET_ONLY'});
    assert.equal(f.calls.options.length,0); assert.equal(f.calls.flags.length,0);
  } finally { f.client.close(); }
});
test('alpha ignores obsolete enable flags and refuses endpoint environment overrides', () => {
  for (const name of ['HEDERA_NODE_URL','HEDERA_MIRROR_URL','HEDERA_MIRROR_NODE_URL','HEDERA_GRPC_ENDPOINT'])
    assert.throws(() => configuration({[name]:'https://mainnet.mirrornode.hedera.com'}),{code:'TESTNET_ONLY'});
  assert.throws(() => configuration({HEDERA_NETWORK:'mainnet',RADIX_HEDERA_MAINNET_ENABLED:'true'}),{code:'TESTNET_ONLY'});
  assert.equal(configuration({RADIX_HEDERA_MAINNET_ENABLED:'true'}).network,'testnet');
  assert.throws(() => makeClient(configuration({}),{forTestnet() { assert.fail('client factory override must not run'); }}),{code:'TESTNET_ONLY'});
});
test('alpha refuses altered internal SDK network maps before preparation', async () => {
  const f = rpcFixture();
  try {
    f.client._network.setNetwork({'mainnet-node00-00-grpc.hedera.com:50211':account});
    await assert.rejects(message(f.config,f.client),{code:'TESTNET_ONLY'});
    assert.equal(f.calls.options.length,0); assert.equal(f.calls.flags.length,0);
  } finally { f.client.close(); }
});
test('alpha endpoint environment change during readiness refuses concrete send', async () => {
  const prior = process.env.HEDERA_NODE_URL; const f = rpcFixture({revokeDuring:'endpoint'});
  try {
    await assert.rejects(executeSdkTransaction(f.config,f.client,await message(f.config,f.client)),{code:'TESTNET_ONLY'});
    assert.equal(f.calls.flags.length,0);
  } finally { f.client.close(); if (prior === undefined) delete process.env.HEDERA_NODE_URL; else process.env.HEDERA_NODE_URL = prior; }
});
