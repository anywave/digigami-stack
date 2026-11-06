import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountId, PublicKey } from '@hiero-ledger/sdk';
import { proto } from '@hiero-ledger/proto';
import { configuration, HederaLayer, topicKeyRequest } from '../src/index.mjs';
import { makeClient, prepareSdkTransaction } from '../src/sdk.mjs';

const account = AccountId.fromString('0.0.123');
const ed25519 = PublicKey.fromStringED25519('01'.repeat(32));
// Public curve generator fixture only; neither fixture has a private signer.
const ecdsa = PublicKey.fromStringECDSA('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
const typeOf = publicKey => publicKey.type === 'secp256k1' ? 'ECDSA_SECP256K1' : publicKey.type;
const mirrorKey = wireKey => wireKey == null ? null : wireKey.ed25519?.length
  ? {_type:'ED25519',key:Buffer.from(wireKey.ed25519).toString('hex')}
  : {_type:'ECDSA_SECP256K1',key:Buffer.from(wireKey.ECDSASecp256k1).toString('hex')};

function pairedFixture({publicKey = ed25519, evidence = keys => keys, mutateAdapter = false} = {}) {
  const config = configuration({HEDERA_MIRROR_ATTEMPTS:'1'}), client = makeClient(config);
  const key = {publicKey,sign:() => new Uint8Array(64)};
  const calls = {execute:0,mirror:0,wire:[],requested:undefined};
  const adapter = {
    operatorId:account.toString(),publicKeyHex:publicKey.toStringRaw(),publicKeyType:typeOf(publicKey),
    async prepare(kind,fields,fee) {
      assert.equal(kind,'createTopic'); calls.requested = fields.topicKeys;
      const tx = await prepareSdkTransaction(config,client,key,account,kind,fields,fee);
      const alternatives = proto.TransactionList.decode(tx.toBytes()).transactionList;
      assert.ok(alternatives.length > 0);
      for (const alternative of alternatives) {
        const signed = proto.SignedTransaction.decode(alternative.signedTransactionBytes);
        const create = proto.TransactionBody.decode(signed.bodyBytes).consensusCreateTopic;
        assert.equal(Object.hasOwn(create,'adminKey'),false,'actual SDK must request absent admin');
        assert.equal(create.adminKey,null);
        const keys = {admin:mirrorKey(create.adminKey),submit:mirrorKey(create.submitKey)};
        assert.deepEqual(keys,{admin:null,submit:{_type:typeOf(publicKey),key:publicKey.toStringRaw()}});
        assert.deepEqual(fields.topicKeys,keys,'shared expected keys must match the signed SDK wire');
        calls.wire.push(keys);
      }
      if (mutateAdapter) { await Promise.resolve(); adapter.publicKeyHex = '02'.repeat(32); adapter.publicKeyType = 'ECDSA_SECP256K1'; }
      return tx;
    },
    execute(tx) { calls.execute++; assert.equal(tx.isFrozen(),true); },
    receipt:() => ({status:'SUCCESS',topicId:'0.0.456',transactionId:'synthetic-transaction'}),
    mirror() {
      calls.mirror++;
      const keys = evidence(calls.wire[0]);
      // Mirror decoding is the same JSON object boundary used by the HTTP adapter.
      return JSON.parse(JSON.stringify({topic_id:'0.0.456',memo:'key-state',admin_key:keys.admin,submit_key:keys.submit}));
    },
  };
  return {layer:new HederaLayer(config,adapter),calls,close:() => client.close()};
}

test('F4-R paired SDK wire confirms explicit absent admin and exact typed submit', async () => {
  for (const publicKey of [ed25519,ecdsa]) {
    const f = pairedFixture({publicKey});
    try {
      let result; await assert.doesNotReject(async () => { result = await f.layer.createTopic('key-state'); });
      assert.equal(result.topicId,'0.0.456'); assert.equal(f.calls.execute,1); assert.equal(f.calls.mirror,1);
    }
    finally { f.close(); }
  }
});
test('F4-R paired SDK wire refuses every contradictory admin and submit combination', async () => {
  const adminCases = [keys => keys.admin, () => undefined, () => ({}), keys => keys.submit,
    () => ({_type:'ED25519',key:'02'.repeat(32)}), () => [], () => false];
  const submitCases = [keys => keys.submit, () => null, () => undefined, () => ({}),
    () => ({_type:'ED25519',key:'02'.repeat(32)}), keys => ({...keys.submit,_type:'ECDSA_SECP256K1'}),
    keys => ({key:keys.submit.key}), () => ({_type:'ED25519'}), keys => ({...keys.submit,unknown:true}), () => []];
  for (let admin = 0; admin < adminCases.length; admin++) for (let submit = 0; submit < submitCases.length; submit++) {
    const f = pairedFixture({evidence:keys => ({admin:adminCases[admin](keys),submit:submitCases[submit](keys)})});
    try {
      if (admin === 0 && submit === 0) assert.equal((await f.layer.createTopic('key-state')).topicId,'0.0.456');
      else await assert.rejects(f.layer.createTopic('key-state'),{code:'MIRROR_MISMATCH'},`admin=${admin} submit=${submit}`);
      assert.equal(f.calls.wire.length > 0,true); assert.equal(f.calls.mirror,1);
    } finally { f.close(); }
  }
});
test('F4-R requested key states stay frozen across asynchronous preparation', async () => {
  const f = pairedFixture({mutateAdapter:true});
  try {
    assert.equal((await f.layer.createTopic('key-state')).topicId,'0.0.456');
    assert.equal(Object.isFrozen(f.calls.requested),true); assert.equal(Object.isFrozen(f.calls.requested.submit),true);
    assert.deepEqual(f.calls.requested,f.calls.wire[0]);
  } finally { f.close(); }
});
test('F4-R SDK builder rejects key metadata that contradicts its actual create request', async () => {
  const config = configuration({}), client = makeClient(config), key = {publicKey:ed25519,sign:() => new Uint8Array(64)};
  const expected = topicKeyRequest(ed25519.toStringRaw(),'ED25519');
  try {
    for (const topicKeys of [{...expected,admin:expected.submit}, {...expected,submit:{...expected.submit,key:'02'.repeat(32)}},
      {...expected,submit:{...expected.submit,_type:'ECDSA_SECP256K1'}}]) {
      await assert.rejects(prepareSdkTransaction(config,client,key,account,'createTopic',{memo:'key-state',topicKeys},12345),{code:'PREPARE_FAILED'});
    }
  } finally { client.close(); }
});
