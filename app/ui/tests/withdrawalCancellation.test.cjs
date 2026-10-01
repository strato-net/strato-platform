const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness({ eligible = true, requestOnly = false, fail = false, fetching = false } = {}) {
  const state = [], calls = [], cache = new Map(); let cursor = 0;
  const key = value => JSON.stringify(value);
  const client = { getQueryData: k => cache.get(key(k)), setQueryData: (k, value) => cache.set(key(k), typeof value === "function" ? value(cache.get(key(k))) : value), invalidateQueries: async () => {} };
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/bridge/WithdrawalCancellation.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports, require: id => {
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (id === 'react') return { useRef: initial => { const index = cursor++; if (!(index in state)) state[index] = { current: initial }; return state[index]; }, useState: initial => { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = value; }]; } };
      if (id === '@tanstack/react-query') return { useQueryClient: () => client, useQuery: options => options.queryKey.at(-1) === 'submitted' ? { data: client.getQueryData(options.queryKey) } : ({ isFetching: fetching, data: { eligible, requestOnly, availableAt: '1', message: 'Cancellation status' } }) };
      if (id === '@/context/UserContext') return { useUser: () => ({ userAddress: 'account' }) };
      if (id === '@/context/TokenContext') return { useTokenContext: () => ({ fetchUsdstBalance: async () => calls.push('fees') }) };
      if (id === '@/context/UserTokensContext') return { useUserTokens: () => ({ fetchTokens: async () => calls.push('balances') }) };
      if (id === '@/lib/axios') return { extractApiErrorMessage: e => e.message, api: { post: async (url, body) => {
        calls.push([url, body.source, body.withdrawalId]); if (fail) throw new Error('Withdrawal already processing');
      } } };
      return new Proxy({}, { get: (_, name) => String(name) });
    },
  });
  const render = () => { cursor = 0; return exports.default({ source: 'native', withdrawalId: '17', onCanceled: () => calls.push('refresh') }); };
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  const button = label => nodes(render()).find(n => n.type === 'Button' && n.props.children === label);
  const open = () => (button('Cancel withdrawal') || button('Cancellation submitted')).props.onClick();
  const submit = () => button(requestOnly ? 'Request cancellation' : 'Confirm cancellation');
  return { calls, render, nodes, open, submit, remount: () => { state.length = 0; }, setFetching: value => { fetching = value; } };
}

test('user cancellation cannot submit during the waiting period', async () => {
  const h = harness({ eligible: false }); h.open();
  assert.equal(h.submit().props.disabled, true);
  await h.submit().props.onClick();
  assert.deepEqual(h.calls, []);
});

test('native pending withdrawal offers a cancellation request and refreshes balances after submission', async () => {
  const h = harness({ requestOnly: true }); h.open();
  await h.submit().props.onClick();
  assert.deepEqual(h.calls, [['/bridge/withdrawalCancellation', 'native', '17'], 'refresh', 'fees', 'balances']);
  assert.equal(h.nodes(h.render()).find(n => n.type === 'Dialog').props.open, false);
});

test('a cancellation race keeps the dialog open and displays the error', async () => {
  const h = harness({ fail: true }); h.open();
  await h.submit().props.onClick();
  assert.equal(h.nodes(h.render()).find(n => n.type === 'Dialog').props.open, true);
  assert.equal(h.nodes(h.render()).find(n => n.props?.role === 'alert').props.children, 'Withdrawal already processing');
  assert.equal(h.calls.includes('refresh'), false);
});


test('cached eligibility cannot resubmit after success, including after remount', async () => {
  const h = harness(); h.open();
  const staleSubmit = h.submit().props.onClick;
  await Promise.all([staleSubmit(), staleSubmit()]);
  h.remount(); h.open();
  assert.equal(h.submit().props.disabled, true);
  await h.submit().props.onClick();
  await staleSubmit();
  assert.equal(h.calls.filter(Array.isArray).length, 1);
});

test('refetching eligibility blocks cancellation even with cached eligible status', async () => {
  const h = harness({ fetching: true }); h.open();
  assert.equal(h.submit().props.disabled, true);
  await h.submit().props.onClick();
  assert.deepEqual(h.calls, []);
  h.setFetching(false);
  assert.equal(h.submit().props.disabled, false);
});
