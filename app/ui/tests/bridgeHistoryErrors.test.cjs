const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/context/BridgeContext.tsx'), 'utf8');
const ast = ts.createSourceFile('BridgeContext.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findCallback(name) {
  let result;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) result = node.initializer.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return result;
}
for (const name of ['fetchDepositTransactions', 'fetchWithdrawTransactions']) {
  test(`${name} distinguishes failed history from a successful empty response`, async () => {
    let fail = true;
    const loading = [];
    const error = new Error('Network unavailable');
    const callback = vm.runInNewContext(ts.transpileModule(`(${findCallback(name)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText, {
      URLSearchParams, apiBase: '/trade/bridge', setLoading: value => loading.push(value),
      api: { get: async () => { if (fail) throw error; return { data: { data: [], totalCount: 0 } }; } },
    });
    await assert.rejects(callback(), e => e === error);
    assert.deepEqual(loading, [true, false]);
    fail = false;
    const result = await callback();
    assert.equal(result.totalCount, 0);
    assert.equal(result.data.length, 0);
  });
}

for (const name of ['Deposit', 'Withdraw']) {
  test(`${name} history shows an alert on failure and retries successfully`, async () => {
    const state = [], effects = [];
    let cursor = 0, fail = true;
    const jsx = (type, props) => ({ type, props });
    const fetch = async () => { if (fail) throw new Error('Network unavailable'); return { data: [], totalCount: 0 }; };
    const exported = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, `../src/components/dashboard/${name}TransactionDetails.tsx`), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { exports: exported, require: id => {
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (id === 'react') return {
        useState: initial => { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
        useEffect: fn => effects.push(fn), useMemo: fn => fn(),
      };
      if (id === '@/context/BridgeContext') return { useBridgeContext: () => ({ fetchDepositTransactions: fetch, fetchWithdrawTransactions: fetch, availableNetworks: [], bridgeableTokens: [] }) };
      if (id === '@/context/UserContext') return { useUser: () => ({ userAddress: 'user' }) };
      if (id === '@/hooks/use-mobile') return { useIsMobile: () => false };
      if (id === '@/lib/bridge/utils') return { ExternalBridgeStatus: {}, mergePendingDeposits: () => ({ remaining: [] }) };
      return new Proxy({}, { get: (_, key) => String(key) });
    } });
    const render = () => { cursor = 0; return exported.default({}); };
    const nodes = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)];
    render(); effects.shift()();
    await new Promise(resolve => setImmediate(resolve));
    let tree = nodes(render());
    assert.ok(tree.some(n => n.props?.role === 'alert'));
    assert.equal(tree.some(n => n.type === 'Table'), false);
    tree.find(n => n.type === 'Button' && n.props.children === 'Retry').props.onClick();
    fail = false; effects.length = 0;
    render(); effects.shift()();
    await new Promise(resolve => setImmediate(resolve));
    tree = nodes(render());
    assert.equal(tree.some(n => n.props?.role === 'alert'), false);
    assert.ok(tree.some(n => n.type === 'Table'));
  });
}
