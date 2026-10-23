const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/dashboard/activityTypes.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { exports: exportsObject, require: id => {
  if (id === 'react/jsx-runtime') return require(id);
  if (id === 'viem') return require('viem');
  if (id === '@/lib/constants') return { usdstAddress: '9'.repeat(40) };
  if (id === '@/lib/bridge/utils') return { getChainName: () => 'Test', getExplorerUrl: () => '' };
  return {};
}});
const { activityTypes } = exportsObject;
const input = 'ab'.repeat(20), output = 'cd'.repeat(20);
const symbols = new Map([[input, 'IN'], [output, 'OUT']]);
const card = (type, attributes, decimals, extra = {}) => activityTypes[type].handler(
  { attributes, address: input, ...extra }, symbols, null, undefined, decimals);

test('routed cards use independent asset decimals and exact tooltip amounts', () => {
  for (const precision of [0, 2, 6, 18]) {
    const amount = String(12n * 10n ** BigInt(precision));
    const result = card('RoutedTrade', { tokenIn: `0X${input.toUpperCase()}`, tokenOut: output, amountIn: amount, amountOut: '345' }, new Map([[input, precision], [output, 2]]));
    assert.equal(result.fields[0].value, '12.0000');
    assert.equal(result.fields[0].rawAmount, '12');
    assert.equal(result.fields[1].value, '3.4500');
    assert.equal(result.fields[1].rawAmount, '3.45');
  }
  const exact = '123456789012345678.123456789012345678';
  const result = card('RoutedTrade', { tokenIn: input, tokenOut: output, amountIn: exact.replace('.', ''), amountOut: '1' }, new Map([[input, 18], [output, 0]]));
  assert.equal(result.fields[0].rawAmount.replaceAll(',', ''), exact);
});

test('bridge deposit wrappers preserve final-token precision for routes and fallback', () => {
  for (const type of ['Deposit', 'ExternalDeposit', 'NativeDeposit']) {
    if (!activityTypes[type]) throw new Error(`Missing ${type}`);
    for (const depositOutcome of ['route', 'fallback']) {
      const result = card(type, { stratoToken: input, stratoTokenAmount: '1000000' }, new Map([[input, 6], [output, 2]]),
        { depositOutcome, finalToken: output, finalAmount: '345' });
      assert.equal(result.fields[0].value, '3.4500');
      assert.equal(result.fields[0].rawAmount, '3.45');
    }
  }
});

test('metal cards use payment and metal decimals independently', () => {
  const result = card('MetalMinted', { payToken: input, metalToken: output, payAmount: '1230000', metalAmount: '456' }, new Map([[input, 6], [output, 2]]));
  assert.equal(result.fields[0].value, '1.2300');
  assert.equal(result.fields[0].rawAmount, '1.23');
  assert.equal(result.fields[1].value, '4.5600');
  assert.equal(result.fields[1].rawAmount, '4.56');
});
