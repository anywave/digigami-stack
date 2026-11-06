import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, AccountId, PublicKey } from '@hiero-ledger/sdk';
import { makeClient, prepareSdkTransaction, sdkLayer } from '../src/sdk.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, openSync, closeSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configuration } from '../src/index.mjs';

test('invalid network never calls SDK client factory', () => {
  let calls = 0;
  const factory = {forTestnet() { calls++; }, forMainnet() { assert.fail('alpha must never construct a mainnet client'); }};
  for (const network of ['mainnet','bad','constructor','toString','__proto__'])
    assert.throws(() => makeClient({network},factory), {code:'TESTNET_ONLY'});
  assert.throws(() => makeClient({network:'mainnet',RADIX_HEDERA_MAINNET_ENABLED:'true'},factory), {code:'TESTNET_ONLY'});
  assert.equal(calls,0);
});
test('SDK adapter requires runtime environment credentials', () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !['HEDERA_OPERATOR_ID','HEDERA_OPERATOR_KEY'].includes(name)));
  env.HEDERA_NETWORK = 'testnet';
  const dir = mkdtempSync(join(tmpdir(),'hedera-env-test-'));
  const log = join(dir,'result'); const fd = openSync(log,'w');
  try {
    const code = `import {sdkLayer} from ${JSON.stringify(new URL('../src/sdk.mjs',import.meta.url).href)}; try {sdkLayer(); process.exitCode=2;} catch(e) {console.log(e.code);}`;
    const result = spawnSync(process.execPath,['--input-type=module','-e',code],{env,stdio:['ignore',fd,fd]});
    assert.equal(result.status,0); assert.equal(result.error,undefined);
    assert.equal(readFileSync(log,'utf8').trim(),'OPERATOR_ENV_REQUIRED');
  } finally { closeSync(fd); rmSync(dir,{recursive:true,force:true}); }
});
test('real SDK transaction pins fee, submit key, single chunk and stable ID offline', async () => {
  const client = makeClient(configuration({}));
  const account = AccountId.fromString('0.0.123');
  // Public fixture only; fake signer supplies bytes without any private key.
  const publicKey = PublicKey.fromStringED25519('01'.repeat(32));
  const key = {publicKey, sign: () => new Uint8Array(64)};
  try {
    for (const kind of ['createTopic','submitRecord']) {
      const tx = await prepareSdkTransaction(configuration({}),client,key,account,kind,
        {memo:'test',topicId:'0.0.456',bytes:Buffer.from('synthetic')},12345);
      assert.equal(tx.maxTransactionFee.toTinybars().toString(),'12345');
      assert.equal(tx.regenerateTransactionId,false);
      assert.equal(tx.isFrozen(),true);
      if (kind === 'createTopic') assert.equal(tx.submitKey?.toStringRaw(),publicKey.toStringRaw());
      else assert.equal(tx.maxChunks,1);
      const id = tx.transactionId.toString();
      assert.equal(tx.transactionId.toString(),id);
    }
  } finally { client.close(); }
});
