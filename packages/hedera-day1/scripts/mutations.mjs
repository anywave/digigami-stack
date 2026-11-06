// Behavioral mutation checks run in scratch copies; production source is never edited.
import { mkdtemp, cp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { openSync, closeSync, readFileSync } from 'node:fs';
const root = fileURLToPath(new URL('../', import.meta.url));
const mutations = [
  ['testnet default', "const network = env.HEDERA_NETWORK ?? 'testnet';", "const network = env.HEDERA_NETWORK ?? 'mainnet';"],
  ['alpha testnet-only config', "if (network !== 'testnet') fail('TESTNET_ONLY');", ''],
  ['runtime network before prepare', '  async #write(kind, fields) {\n    authorizeSend(this.#config);', '  async #write(kind, fields) {'],
  ['fee ceiling', 'n > max', 'false'],
  ['fee forwarding', 'fields, this.#config.maxFeeTinybars', 'fields, undefined'],
  ['bounded retries', 'n < attempts', 'n < attempts + 1'],
  ['same transaction retry', '() => { authorizeSend(this.#config); return this.#adapter.execute(transaction); }', 'async () => { authorizeSend(this.#config); return this.#adapter.execute(await this.#adapter.prepare(kind, fields, this.#config.maxFeeTinybars)); }'],
  ['receipt check', "if (receipt.status !== 'SUCCESS') fail('RECEIPT_NOT_SUCCESS');", ''],
  ['topic mirror readback', 'await this.#poll(`/api/v1/topics/${receipt.topicId}`,', 'await Promise.resolve(null); false && await this.#poll(`/api/v1/topics/${receipt.topicId}`,'],
  ['topic submit key pin', '&& mirrorKeyMatches(value.submit_key, requestedKeys.submit)', '', 'index.mjs', 'topic-keys.test.mjs', 'F4-R paired SDK wire refuses every contradictory admin and submit combination'],
  ['payer pin', '&& value.payer_account_id === this.#adapter.operatorId', ''],
  ['byte equality', '&& equalBytes(parseMirrorMessage(value.message), bytes)', ''],
  ['message mirror readback', 'const message = await this.#poll(`/api/v1/topics/${topicId}/messages/${sequence}`,', 'const message = {consensus_timestamp: null}; false && await this.#poll(`/api/v1/topics/${topicId}/messages/${sequence}`,'],
  ['signature verification', "if (!verified) fail('SIGNATURE_INVALID');", ''],
  ['runtime-only operator credentials', "if (!operatorId || !encodedKey) throw new HederaError('OPERATOR_ENV_REQUIRED');", '', 'sdk.mjs', 'sdk.test.mjs'],
  ['SDK fee cap', '.setMaxTransactionFee(Hbar.fromTinybars(maxFeeTinybars))', '', 'sdk.mjs', 'sdk.test.mjs'],
  ['SDK fixed transaction ID', '.setRegenerateTransactionId(false)', '', 'sdk.mjs', 'sdk.test.mjs'],
  ['SDK topic submit key', '.setSubmitKey(key.publicKey)', '', 'sdk.mjs', 'sdk.test.mjs'],
  ['F1 preflight read', 'topic = await this.#adapter.topicPolicy(topicId)', "topic = {topic_id:topicId,custom_fees:{fixed_fees:[]}}", 'index.mjs', 'fixes.test.mjs', 'F1 every message submission reads zero-fee policy before prepare'],
  ['F1 nonzero fee refusal', 'topic.custom_fees.fixed_fees.length !== 0', 'false', 'index.mjs', 'fixes.test.mjs', 'F1 topic fee preflight rejects nonzero HBAR and HTS before preparation'],
  ['F1 unknown fee schema', "Object.keys(topic.custom_fees).some(key => !['created_timestamp', 'fixed_fees'].includes(key))", 'false', 'index.mjs', 'fixes.test.mjs', 'F1 unreadable missing malformed or unknown fee schedules refuse all sends'],
  ['F1 payer wire allowance', '.setCustomFeeLimits([new CustomFeeLimit({accountId: account, fees: [new CustomFixedFee({amount: 0})]})])', '', 'sdk.mjs', 'fixes.test.mjs', 'F1 actual SDK wire has payer zero HBAR cap and no allowed HTS denominations'],
  ['F1 wire payer binding', 'accountId: account, fees:', 'accountId: undefined, fees:', 'sdk.mjs', 'fixes.test.mjs', 'F1 actual SDK wire has payer zero HBAR cap and no allowed HTS denominations'],
  ['F1 zero wire amount', 'CustomFixedFee({amount: 0})', 'CustomFixedFee({amount: 1})', 'sdk.mjs', 'fixes.test.mjs', 'F1 actual SDK wire has payer zero HBAR cap and no allowed HTS denominations'],
  ['F1 no HTS denomination', 'CustomFixedFee({amount: 0})', "CustomFixedFee({amount: 0,denominatingTokenId:'0.0.999'})", 'sdk.mjs', 'fixes.test.mjs', 'F1 actual SDK wire has payer zero HBAR cap and no allowed HTS denominations'],
  ['F2 after-prepare authorization', 'authorizeSend(this.#config); return this.#adapter.execute(transaction);', 'return this.#adapter.execute(transaction);', 'index.mjs', 'fixes.test.mjs', 'F2 network change during delayed prepare prevents first shared send'],
  ['F2 SDK request boundary', 'try { authorizeSend(config); } catch (error) { return Promise.reject(error); }', '', 'sdk.mjs', 'fixes.test.mjs', 'F2 actual SDK request-signing network change blocks before RPC acquisition'],
  ['F2 concrete gRPC authorization', 'try { authorizeSend(config); validateTarget(); } catch (error) { args.at(-1)(error); return; }', '', 'transport.mjs', 'fixes.test.mjs', 'F2 actual SDK ready network change blocks concrete gRPC send'],
  ['F2 one SDK attempt', 'tx.setMaxAttempts(1);', 'tx.setMaxAttempts(config.maxAttempts);', 'sdk.mjs', 'fixes.test.mjs', 'F2 real SDK has one consensus attempt and gRPC hidden retries disabled'],
  ['F2 one client attempt', 'this.setMaxAttempts(1);', '', 'sdk.mjs', 'fixes.test.mjs', 'F2 real SDK has one consensus attempt and gRPC hidden retries disabled'],
  ['F2 no gRPC hidden retries', "'grpc.enable_retries': 0", "'grpc.enable_retries': 1", 'transport.mjs', 'fixes.test.mjs', 'F2 real SDK has one consensus attempt and gRPC hidden retries disabled'],
  ['F1 malformed timestamp', "(Object.hasOwn(topic.custom_fees, 'created_timestamp')\n        && (typeof topic.custom_fees.created_timestamp !== 'string' || !/^\\d{1,10}(\\.\\d{1,9})?$/.test(topic.custom_fees.created_timestamp)))", 'false', 'index.mjs', 'fixes.test.mjs', 'F1 unreadable missing malformed or unknown fee schedules refuse all sends'],
  ['alpha immutable SDK network', "if (testnetTargets.has(this)) throw new HederaError('TESTNET_ONLY');", '', 'sdk.mjs', 'fixes.test.mjs', 'alpha rejects SDK endpoint mutations and arbitrary channel targets'],
  ['alpha final channel destination', "if (!allowedTargets?.has(address) || channel.address !== address || `${channel.nodeIp}:${channel.nodePort}` !== address)", 'if (false)', 'transport.mjs', 'fixes.test.mjs', 'alpha rejects SDK endpoint mutations and arbitrary channel targets'],
  ['alpha client network snapshot', 'addresses.length !== targets.size || addresses.some(address => !targets.has(address))', 'false', 'sdk.mjs', 'fixes.test.mjs', 'alpha refuses altered internal SDK network maps before preparation'],
  ['alpha endpoint environment config', "if (endpointVariables.some(name => env[name] !== undefined)) fail('TESTNET_ONLY');", '', 'index.mjs', 'fixes.test.mjs', 'alpha ignores obsolete enable flags and refuses endpoint environment overrides'],
  ['alpha endpoint environment at send', '|| endpointVariables.some(name => process.env[name] !== undefined)', '', 'index.mjs', 'fixes.test.mjs', 'alpha endpoint environment change during readiness refuses concrete send'],
  ['alpha guarded SDK helper clients', 'authorizeSend(config); requireSafeClient(client);', 'authorizeSend(config);', 'sdk.mjs', 'fixes.test.mjs', 'alpha SDK helpers refuse arbitrary unguarded clients'],
  ['F4-R absent admin pin', '&& mirrorKeyMatches(value.admin_key, requestedKeys.admin)', '', 'index.mjs', 'topic-keys.test.mjs', 'F4-R paired SDK wire refuses every contradictory admin and submit combination'],
  ['F4-R key type comparison', 'actual._type === expected._type', 'true', 'index.mjs', 'topic-keys.test.mjs', 'F4-R paired SDK wire refuses every contradictory admin and submit combination'],
  ['F4-R key bytes comparison', 'actual.key === expected.key', 'true', 'index.mjs', 'topic-keys.test.mjs', 'F4-R paired SDK wire refuses every contradictory admin and submit combination'],
  ['F4-R malformed key object', 'Object.keys(actual).length === 2', 'true', 'index.mjs', 'topic-keys.test.mjs', 'F4-R paired SDK wire refuses every contradictory admin and submit combination'],
  ['F4-R request and wire agreement', "if (fields.topicKeys.admin !== expected.admin || fields.topicKeys.submit?._type !== expected.submit._type\n        || fields.topicKeys.submit?.key !== expected.submit.key) throw new HederaError('PREPARE_FAILED');", '', 'sdk.mjs', 'topic-keys.test.mjs', 'F4-R SDK builder rejects key metadata that contradicts its actual create request'],
  ['F4-R SDK requested admin absence', '.setTopicMemo(fields.memo).setSubmitKey(key.publicKey)', '.setTopicMemo(fields.memo).setSubmitKey(key.publicKey).setAdminKey(key.publicKey)', 'sdk.mjs', 'topic-keys.test.mjs', 'F4-R paired SDK wire confirms explicit absent admin and exact typed submit'],
  ['F4-R immutable requested key state', 'return Object.freeze({admin: null, submit: Object.freeze({_type: publicKeyType, key: publicKeyHex})});', 'return {admin: null, submit: {_type: publicKeyType, key: publicKeyHex}};', 'index.mjs', 'topic-keys.test.mjs', 'F4-R requested key states stay frozen across asynchronous preparation'],
];
let failed = false;
for (const [name, before, after, target = 'index.mjs', suite = 'layer.test.mjs', expected] of mutations) {
  const dir = await mkdtemp(join(tmpdir(), 'hedera-js-mutation-'));
  try {
    await cp(join(root,'src'),join(dir,'src'),{recursive:true});
    await cp(join(root,'test'),join(dir,'test'),{recursive:true});
    await symlink(join(root,'node_modules'),join(dir,'node_modules'),'dir');
    const path = join(dir,'src',target); const original = await readFile(path,'utf8');
    if (!original.includes(before)) throw Error(`Unmatched mutation ${name}`);
    let mutated = original.replace(before,after);
    if (name === 'bounded retries') mutated = mutated.replace('n === attempts - 1','n === attempts');
    await writeFile(path,mutated);
    const log = join(dir,'runner.log'); const fd = openSync(log,'w');
    const syntax = spawnSync(process.execPath,['--check',path],{stdio:['ignore',fd,fd]});
    if (syntax.status !== 0 || syntax.error) { closeSync(fd); throw Error(`Invalid mutant syntax: ${name}`); }
    const result = spawnSync(process.execPath,[join(dir,'test',suite)],{timeout:10000,stdio:['ignore',fd,fd]});
    closeSync(fd); const output = readFileSync(log,'utf8');
    const killed = !result.error && Number.isInteger(result.status) && result.status !== 0
      && /(?:fail [1-9]|not ok)/.test(output) && /ERR_ASSERTION/.test(output)
      && (!expected || output.includes(`✖ ${expected}`) || output.includes(`not ok - ${expected}`)) && !/SyntaxError|ERR_MODULE_NOT_FOUND/.test(output);
    console.log(`${killed ? 'KILLED' : 'SURVIVED'}: ${name}`);
    failed ||= !killed;
  } finally { await rm(dir,{recursive:true,force:true}); }
}
if (failed) process.exitCode = 1;
