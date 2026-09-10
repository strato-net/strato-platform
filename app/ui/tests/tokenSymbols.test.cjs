const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const load = (get) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/metalActivity.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: () => ({ api: { get } }) });
  return exports.resolveTokenSymbols;
};

test('batches and deduplicates symbols while preserving address aliases', async () => {
  const address = 'ab'.repeat(20);
  let calls = 0;
  const resolve = load(async (url, { params }) => {
    calls++;
    assert.equal(url, '/tokens/symbols');
    assert.equal(params.addresses, address);
    return { data: [{ address, _symbol: 'SHARE' }] };
  });
  const symbols = await resolve([address, `0x${address.toUpperCase()}`, address]);
  assert.equal(calls, 1);
  assert.equal(symbols.get(`0x${address.toUpperCase()}`), 'SHARE');
  assert.equal(symbols.get(address), 'SHARE');
  await resolve([]);
  assert.equal(calls, 1);
});

test('bounds each metadata request and tolerates unavailable symbols', async () => {
  let calls = 0;
  const resolve = load(async (_, { params }) => {
    calls++;
    assert(params.addresses.split(',').length <= 100);
    throw new Error('offline');
  });
  assert.equal((await resolve(Array.from({ length: 101 }, (_, index) => index.toString(16).padStart(40, '0')))).size, 0);
  assert.equal(calls, 2);
});
