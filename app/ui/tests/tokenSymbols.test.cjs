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
  return exports;
};

test('batches and deduplicates symbols while preserving address aliases', async () => {
  const address = 'ab'.repeat(20);
  let calls = 0;
  const { resolveTokenMetadata: resolve } = load(async (url, { params }) => {
    calls++;
    assert.equal(url, '/tokens/symbols');
    assert.equal(params.addresses, address);
    return { data: [{ address, _symbol: 'SHARE', customDecimals: '6' }] };
  });
  const symbols = await resolve([address, `0x${address.toUpperCase()}`, address]);
  assert.equal(calls, 1);
  assert.equal(symbols.get(`0x${address.toUpperCase()}`)._symbol, 'SHARE');
  assert.equal(symbols.get(address).customDecimals, 6);
  await resolve([]);
  assert.equal(calls, 1);
});

test('bounds each metadata request and tolerates unavailable symbols', async () => {
  let calls = 0;
  const { resolveTokenMetadata: resolve } = load(async (_, { params }) => {
    calls++;
    assert(params.addresses.split(',').length <= 100);
    throw new Error('offline');
  });
  assert.equal((await resolve(Array.from({ length: 101 }, (_, index) => index.toString(16).padStart(40, '0')))).size, 0);
  assert.equal(calls, 2);
});

const transpile = (source, fileName = 'test.tsx') => ts.transpileModule(source, {
  fileName,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const numberUtils = {};
vm.runInNewContext(transpile(fs.readFileSync(path.join(__dirname, '../src/utils/numberUtils.ts'), 'utf8'), 'numberUtils.ts'), {
  exports: numberUtils, require,
});

test('metal activity retains separate payment and output decimals, including zero', async () => {
  const { resolveTokenMetadata, mapEventsToMetalTxs } = load(async () => ({ data: [
    { address: 'pay', _symbol: 'PAY', customDecimals: 6 },
    { address: 'metal', _symbol: 'METAL', customDecimals: 0 },
  ] }));
  const metadata = await resolveTokenMetadata(['pay', 'metal']);
  const [tx] = mapEventsToMetalTxs([{ attributes: { payToken: 'pay', metalToken: 'metal', payAmount: '1250000', metalAmount: '2' } }], metadata);
  assert.equal(numberUtils.formatBalance(tx.payAmount, undefined, tx.payDecimals, 2, 4), '1.25');
  assert.equal(numberUtils.formatBalance(tx.metalAmount, undefined, tx.metalDecimals, 2, 4), '2.00');
});

async function recentRows({ deposits = [], routes = [], metals = [], pending = [], unified = false }) {
  const exports = {};
  const states = [];
  let stateIndex = 0, firstRender = true, loaded;
  const ready = new Promise((resolve) => { loaded = resolve; });
  const input = 'ab'.repeat(20), output = 'cd'.repeat(20);
  const metadataModule = load(async () => ({ data: [
    { address: input, _symbol: 'SAME', customDecimals: 6 },
    { address: output, _symbol: 'SAME', customDecimals: 2 },
  ] }));
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(transpile(fs.readFileSync(path.join(__dirname, '../src/components/bridge/RecentTransactions.tsx'), 'utf8')), {
    exports, require: (id) => {
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (id === 'react') return {
        useState: (initial) => {
          const index = stateIndex++;
          if (firstRender) states[index] = initial;
          return [states[index], (value) => { states[index] = value; if (index === (metals.length && !unified ? 3 : 1) && value === false) loaded(); }];
        },
        useEffect: (callback) => { if (firstRender) callback(); },
        useMemo: (callback) => callback(), useCallback: (callback) => callback,
        useRef: (current) => ({ current }),
      };
      if (id === '@/context/UserContext') return { useUser: () => ({ isLoggedIn: true }) };
      if (id === '@/context/BridgeContext') return { useBridgeContext: () => ({
        fetchDepositTransactions: async () => ({ data: deposits }), fetchWithdrawTransactions: async () => ({ data: [] }),
        availableNetworks: [], bridgeableTokens: [],
      }) };
      if (id === '@/lib/bridge/utils') return { ExternalBridgeStatus: { COMPLETED: 4 }, mergePendingDeposits: () => ({ remaining: pending }) };
      if (id === '@/lib/metalActivity') return metadataModule;
      if (id === '@/utils/numberUtils') return numberUtils;
      if (id === '@/hooks/use-mobile') return { useIsMobile: () => false };
      if (id === '@/lib/activityFeed') return { activityFeedApi: { getActivities: async (pairs) => ({ events: [...routes.map(event => ({ event_name: 'RouteExecuted', ...event })), ...metals.map(event => ({ event_name: 'MetalMinted', ...event }))].filter(event => pairs.some(pair => pair.event_name === event.event_name)) }) } };
      return {};
    },
  });
  const props = { includeRoutes: true, fundingMode: metals.length && !unified ? 'metals' : 'bridge' };
  exports.default(props);
  await ready;
  firstRender = false; stateIndex = 0;
  const tree = exports.default(props);
  const rows = [];
  function visit(node) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || !node.props) return;
    if (node.type?.name === 'TxRow') rows.push(node.props);
    visit(node.props.children);
  }
  visit(tree);
  return rows;
}

const input = 'ab'.repeat(20), output = 'cd'.repeat(20);
test('routed trade amounts use address-specific input and output decimals', async () => {
  const [row] = await recentRows({ routes: [{ attributes: { tokenIn: `0x${input.toUpperCase()}`, tokenOut: output, amountIn: '1250000', amountOut: '250' } }] });
  assert.equal(row.label, 'Trade on STRATO');
  assert.equal(row.fromAmount, '1.25');
  assert.equal(row.toAmount, '2.50');
});

for (const source of ['deposits', 'pending']) {
  test(`${source} routed deposits retain output token decimals`, async () => {
    const [row] = await recentRows({ [source]: [{ type: 'route', depositOutcome: 'route', finalToken: output, finalAmount: '250',
      DepositInfo: { stratoToken: input, stratoTokenAmount: '1250000', bridgeStatus: '4' } }] });
    assert.equal(row.label, 'Bridge & Trade');
    assert.equal(row.fromAmount, '1.25');
    assert.equal(row.toAmount, '2.50');
  });
}

test('recent metal purchases format payment and metal amounts separately', async () => {
  const [row] = await recentRows({ metals: [{ attributes: { payToken: input, metalToken: output, payAmount: '1250000', metalAmount: '250' } }] });
  assert.equal(row.fromAmount, '1.25');
  assert.equal(row.toAmount, '2.50');
});

test('fallback warning uses bridged-token decimals, including zero and missing routes', () => {
  const source = ts.createSourceFile('RouterWidget.tsx', fs.readFileSync(path.join(__dirname, '../src/components/router/RouterWidget.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let bridgedToken, formatFallback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'bridgedToken') bridgedToken = node.getText(source);
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'formatUnits' && node.arguments[0]?.getText(source) === 'compositeQuote.data.bridge.bridgedAmount') formatFallback = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  const summary = ts.createSourceFile('summary.tsx', fs.readFileSync(path.join(__dirname, '../src/components/router/RouteTradeSummary.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function findFormat(node) {
    if (ts.isCallExpression(node) && node.expression.getText(summary) === 'formatUnits' && node.arguments[0]?.getText(summary) === 'bridge.bridgedAmount') formatFallback = node.getText(summary);
    ts.forEachChild(node, findFormat);
  }
  findFormat(summary);
  for (const decimals of [0, 2, 6, 18]) {
    const exports = {};
    vm.runInNewContext(transpile(`const ${bridgedToken}; const fallbackDecimals = bridgedToken?.customDecimals ?? 18; exports.value = ${formatFallback};`), {
      exports, ensureHexPrefix: numberUtils.ensureHexPrefix, formatUnits: numberUtils.formatUnits,
      routeAssetsQuery: { data: [{ address: input, customDecimals: decimals }, { address: output, customDecimals: 18 }] },
      externalRoute: { stratoToken: `0x${input.toUpperCase()}` },
      bridge: { bridgedAmount: (2n * 10n ** BigInt(decimals)).toString() },
    });
    assert.equal(Number(exports.value), 2);
  }
  assert.doesNotThrow(() => vm.runInNewContext(transpile(`const ${bridgedToken};`), {
    ensureHexPrefix: numberUtils.ensureHexPrefix, routeAssetsQuery: { data: [{ address: input, customDecimals: 6 }] }, externalRoute: undefined,
  }));
});

test('unified activity shows routed trades only; metal purchases stay on the Buy Metals page', async () => {
  const rows = await recentRows({ unified: true,
    routes: [{ block_timestamp: '2026-09-23T12:00:00Z', attributes: { tokenIn: input, tokenOut: output, amountIn: '1000000', amountOut: '100' } }],
    metals: [{ block_timestamp: '2026-09-23T13:00:00Z', attributes: { payToken: input, metalToken: output, payAmount: '1250000', metalAmount: '250' } }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, 'Trade on STRATO');
});

test('metal effective price includes mint spread and rejects unusable oracle prices', () => {
  assert.equal(numberUtils.effectiveDollarWei('99000000000000000000', '100'), '$100.00');
  assert.equal(numberUtils.effectiveDollarWei('0', '100'), null);
  assert.equal(numberUtils.effectiveDollarWei('1000000000000000000', '10000'), null);
});

test('trade USD estimates respect token decimals and omit missing prices', () => {
  for (const decimals of [0, 2, 6, 18]) {
    assert.equal(numberUtils.formatTokenUsd((2n * 10n ** BigInt(decimals)).toString(), decimals, '3500000000000000000'), '$7.00');
  }
  assert.equal(numberUtils.formatTokenUsd('1', 6, undefined), null);
  assert.equal(numberUtils.formatTokenUsd('1', 6, 'bad price'), null);
});
