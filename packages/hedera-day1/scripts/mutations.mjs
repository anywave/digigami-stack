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
  ['mainnet RADIX gate', "if (network === 'mainnet' && env.RADIX_HEDERA_MAINNET_ENABLED !== 'true') fail('MAINNET_DISABLED');", ''],
  ['revoked RADIX switch', "if (this.#config.network === 'mainnet' && process.env.RADIX_HEDERA_MAINNET_ENABLED !== 'true') fail('MAINNET_DISABLED');", ''],
  ['fee ceiling', 'n > max', 'false'],
  ['fee forwarding', 'fields, this.#config.maxFeeTinybars', 'fields, undefined'],
  ['bounded retries', 'n < attempts', 'n < attempts + 1'],
  ['same transaction retry', '() => this.#adapter.execute(transaction)', 'async () => this.#adapter.execute(await this.#adapter.prepare(kind, fields, this.#config.maxFeeTinybars))'],
  ['receipt check', "if (receipt.status !== 'SUCCESS') fail('RECEIPT_NOT_SUCCESS');", ''],
  ['topic mirror readback', 'await this.#poll(`/api/v1/topics/${receipt.topicId}`,', 'await Promise.resolve(null); false && await this.#poll(`/api/v1/topics/${receipt.topicId}`,'],
  ['topic submit key pin', '&& value.submit_key?.key === this.#adapter.publicKeyHex', ''],
  ['payer pin', '&& value.payer_account_id === this.#adapter.operatorId', ''],
  ['byte equality', '&& equalBytes(parseMirrorMessage(value.message), bytes)', ''],
  ['message mirror readback', 'const message = await this.#poll(`/api/v1/topics/${topicId}/messages/${sequence}`,', 'const message = {consensus_timestamp: null}; false && await this.#poll(`/api/v1/topics/${topicId}/messages/${sequence}`,'],
  ['signature verification', "if (!verified) fail('SIGNATURE_INVALID');", ''],
  ['runtime-only operator credentials', "if (!operatorId || !encodedKey) throw new HederaError('OPERATOR_ENV_REQUIRED');", '', 'sdk.mjs', 'sdk.test.mjs'],
  ['SDK fee cap', '.setMaxTransactionFee(Hbar.fromTinybars(maxFeeTinybars))', '', 'sdk.mjs', 'sdk.test.mjs'],
  ['SDK fixed transaction ID', '.setRegenerateTransactionId(false)', '', 'sdk.mjs', 'sdk.test.mjs'],
  ['SDK topic submit key', '.setSubmitKey(key.publicKey)', '', 'sdk.mjs', 'sdk.test.mjs'],
];
let failed = false;
for (const [name, before, after, target = 'index.mjs', suite = 'layer.test.mjs'] of mutations) {
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
      && /(?:fail [1-9]|not ok)/.test(output) && /ERR_ASSERTION/.test(output) && !/SyntaxError|ERR_MODULE_NOT_FOUND/.test(output);
    console.log(`${killed ? 'KILLED' : 'SURVIVED'}: ${name}`);
    failed ||= !killed;
  } finally { await rm(dir,{recursive:true,force:true}); }
}
if (failed) process.exitCode = 1;
