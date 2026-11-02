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

const bridgeConstants = {};
vm.runInNewContext(transpile(fs.readFileSync(path.join(__dirname, '../src/lib/bridge/constants.ts'), 'utf8')), {
  exports: bridgeConstants, require: () => ({ defineChain: value => value }),
});
const bridgeUtils = {};
vm.runInNewContext(transpile(fs.readFileSync(path.join(__dirname, '../src/lib/bridge/utils.ts'), 'utf8')), {
  exports: bridgeUtils, require: id => id === './constants' ? bridgeConstants : {},
});

test('legacy statuses stay separate from EAB and normalized native history', () => {
  const label = bridgeUtils.getBridgeStatusLabel;
  assert.equal(label(6, 'legacy').text, 'On Hold');
  assert.equal(label(6, 'external').text, 'Refunded');
  assert.equal(label(3, 'external').text, 'Ready');
  for (const source of ['legacy', 'external', 'native']) {
    assert.equal(label(4, source).text, 'Complete');
    assert.equal(label(7, source).text, 'Aborted');
  }
  assert.equal(label(5, 'legacy').text, 'Swept');
  assert.equal(label(3, 'legacy').text, 'Unknown');
  assert(bridgeUtils.LEGACY_DEPOSIT_STATUS_OPTIONS.some(o => o.value === 6 && o.label === 'On Hold'));
  assert(bridgeUtils.DEPOSIT_STATUS_OPTIONS.some(o => o.value === 6 && o.label === 'Refunded'));
  assert(bridgeUtils.DEPOSIT_STATUS_OPTIONS.some(o => o.value === 8 && o.label === 'Refund processing'));
  assert(!bridgeUtils.LEGACY_DEPOSIT_STATUS_OPTIONS.some(o => o.value === 8));
});

test('chain names resolve for numeric and Cirrus string IDs', () => {
  assert.equal(bridgeUtils.getChainName(84532), 'BASE_SEPOLIA');
  assert.equal(bridgeUtils.getChainName('84532'), 'BASE_SEPOLIA');
});

test('EAB deposit rejection and reuse explain recovery without changing withdrawal or legacy statuses', () => {
  const label = bridgeUtils.getDepositStatusLabel;
  assert.equal(label('7', 'external').text, 'Rejected');
  assert.match(label('7', 'external').description, /Your deposit was rejected\. We are working on next steps\. No action is needed from you\./);
  assert.match(label('7', 'external').description, /No action is needed from you/);
  for (const status of [0, '0', '0'.repeat(40)]) {
    assert.equal(label(status, 'external').text, 'Processing');
    assert.match(label(status, 'external').description, /No action is needed from you/);
  }
  for (const status of [undefined, null, '', 'garbled', 99]) {
    assert.equal(label(status, 'external').text, 'Unknown');
    assert.equal(label(status, 'external').description, undefined);
  }
  for (const source of ['native', 'legacy']) {
    assert.equal(label(7, source).text, source === 'native' ? 'Rejected' : 'Aborted');
    assert.equal(label(0, source).text, 'Unknown');
  }
  assert.equal(label(4, 'external').text, 'Complete');
  assert.equal(label(4, 'external').description, undefined);
  assert.equal(bridgeUtils.WITHDRAWAL_STATUS_LABELS[7], 'Canceled');
  for (const source of ['native', 'external']) {
    assert.equal(label(8, source).text, 'Refund processing');
    assert.match(label(8, source).description, /No action is needed/);
    assert.equal(label(6, source).text, 'Refunded');
    assert.match(label(6, source).description, /returned to the sending wallet/);
  }
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

async function recentSession({ deposits = [], routes = [], metals = [], pending = [], unified = false,
  userAddress = '0x' + 'ef'.repeat(20), storageFails = false, fetchDeposits, withdrawalsOnly = false, withdrawals = [] } = {}) {
  const exports = {};
  const states = [];
  let stateIndex = 0, firstRender = true, loaded, cleanup, interval;
  const listeners = new Map();
  const document = { visibilityState: 'visible',
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const window = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
    setInterval: (fn, ms) => { assert.equal(ms, bridgeConstants.RECENT_TRANSACTIONS_REFRESH_MS); interval = fn; return 1; },
    clearInterval: () => { interval = undefined; } };
  const ready = new Promise((resolve) => { loaded = resolve; });
  const input = 'ab'.repeat(20), output = 'cd'.repeat(20);
  const metadataModule = load(async () => ({ data: [
    { address: input, _symbol: 'SAME', customDecimals: 6 },
    { address: output, _symbol: 'SAME', customDecimals: 2 },
  ] }));
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(transpile(fs.readFileSync(path.join(__dirname, '../src/components/bridge/RecentTransactions.tsx'), 'utf8')), {
    exports, window, document, require: (id) => {
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (id === 'react') return {
        useState: (initial) => {
          const index = stateIndex++;
          if (firstRender) states[index] = initial;
          return [states[index], (value) => { states[index] = value; if (index === (metals.length && !unified ? 5 : 3) && value === false) loaded(); }];
        },
        useEffect: (callback) => { if (firstRender) cleanup = callback(); },
        useMemo: (callback) => callback(), useCallback: (callback) => callback,
        useRef: (current) => ({ current }),
      };
      if (id === '@/context/UserContext') return { useUser: () => ({ isLoggedIn: true, userAddress }) };
      if (id === '@/context/BridgeContext') return { useBridgeContext: () => ({
        fetchDepositTransactions: fetchDeposits || (async () => ({ data: deposits })), fetchWithdrawTransactions: async (params) => { if (withdrawalsOnly) assert.equal(params.limit, "5"); return { data: withdrawals }; },
        availableNetworks: [], bridgeableTokens: [],
      }) };
      if (id === '@/lib/bridge/constants') return bridgeConstants;
      if (id === '@/lib/bridge/utils') return { ...bridgeUtils, mergePendingDeposits: () => { if (storageFails) throw new Error('unavailable'); return { remaining: pending }; } };
      if (id === '@/lib/metalActivity') return metadataModule;
      if (id === '@/utils/numberUtils') return numberUtils;
      if (id === '@/hooks/use-mobile') return { useIsMobile: () => false };
      if (id === '@/lib/activityFeed') return { activityFeedApi: { getActivities: async (pairs) => ({ events: [...routes.map(event => ({ event_name: 'RouteExecuted', ...event })), ...metals.map(event => ({ event_name: 'MetalMinted', ...event }))].filter(event => pairs.some(pair => pair.event_name === event.event_name)) }) } };
      return {};
    },
  });
  const props = { withdrawalsOnly, includeRoutes: !withdrawalsOnly, fundingMode: metals.length && !unified ? 'metals' : 'bridge' };
  exports.default(props);
  await ready;
  await new Promise(setImmediate);
  firstRender = false;
  const render = () => {
    stateIndex = 0;
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
  };
  return { render, tick: () => interval?.(), focus: () => listeners.get('focus')?.(),
    visibility: (state) => { document.visibilityState = state; listeners.get('visibilitychange')?.(); },
    close: () => cleanup?.(), listeners, states };
}

async function recentRows(options) {
  const session = await recentSession(options);
  const rows = session.render();
  session.close();
  return rows;
}

const input = 'ab'.repeat(20), output = 'cd'.repeat(20);
test('rejected deposits show Processing after governance reuse on refresh and in another session', async () => {
  const deposits = [{ bridgeSource: 'external', externalSymbol: 'ETH', stratoTokenSymbol: 'ETH',
    DepositInfo: { stratoTokenAmount: '1000000000000000000', bridgeStatus: '7' } }];
  const first = await recentSession({ deposits });
  assert.equal(first.render()[0].status.text, 'Rejected');
  assert.equal(first.render()[0].toAmount, '0');
  assert.match(first.render()[0].status.description, /Your deposit was rejected\. We are working on next steps\. No action is needed from you\./);
  deposits[0].DepositInfo.bridgeStatus = '0'.repeat(40);
  first.tick();
  await new Promise(setImmediate);
  const second = await recentSession({ deposits });
  for (const session of [first, second]) {
    assert.equal(session.render()[0].status.text, 'Processing');
    assert.equal(session.render()[0].toAmount, '0');
    assert.match(session.render()[0].status.description, /No action is needed from you/);
    session.close();
  }
});

test('independent sessions discover indexed bridge deposits without local submissions', async () => {
  const deposits = [];
  const first = await recentSession({ deposits });
  const second = await recentSession({ deposits });
  assert.equal(first.render().length, 0);
  assert.equal(second.render().length, 0);
  deposits.push({ depositOutcome: 'route', finalToken: output, finalAmount: '250',
    DepositInfo: { stratoToken: input, stratoTokenAmount: '1250000', bridgeStatus: '4' } });
  first.focus(); second.tick();
  await new Promise(setImmediate);
  assert.equal(first.render()[0].status.text, 'Complete');
  assert.deepEqual(JSON.parse(JSON.stringify(second.render())), JSON.parse(JSON.stringify(first.render())));
  first.close(); second.close();
});

test('background tabs refresh on return and do not overlap requests or accept results after unmount', async () => {
  let calls = 0, complete;
  const session = await recentSession({ fetchDeposits: async () => {
    calls++;
    if (calls === 1) return { data: [] };
    return new Promise(resolve => { complete = resolve; });
  } });
  session.visibility('hidden'); session.tick(); session.focus();
  assert.equal(calls, 1);
  session.visibility('visible'); session.tick(); session.focus();
  assert.equal(calls, 2, 'only one refresh can be in flight');
  session.close();
  assert.equal(session.listeners.size, 0);
  complete({ data: [{ DepositInfo: { stratoToken: input, stratoTokenAmount: '1', bridgeStatus: '4' } }] });
  await new Promise(setImmediate);
  assert.equal(session.render().length, 0, 'late results cannot repopulate a previous wallet session');
  session.tick(); session.focus();
  assert.equal(calls, 2);
});

test('indexed history survives local storage failure and pending rows belong to the current wallet', async () => {
  const deposit = { DepositInfo: { stratoToken: input, stratoTokenAmount: '1250000', bridgeStatus: '4' } };
  const rows = await recentRows({ deposits: [deposit], storageFails: true });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status.text, 'Complete');
  const pending = ['ef'.repeat(20), '01'.repeat(20)].map(stratoRecipient => ({
    ...deposit, DepositInfo: { ...deposit.DepositInfo, stratoRecipient },
  }));
  assert.equal((await recentRows({ pending, userAddress: '0x' + 'EF'.repeat(20) })).length, 1);
});

test('routed trade amounts use address-specific input and output decimals', async () => {
  const [row] = await recentRows({ routes: [{ attributes: { tokenIn: `0x${input.toUpperCase()}`, tokenOut: output, amountIn: '1250000', amountOut: '250' } }] });
  assert.equal(row.label, 'Trade');
  assert.equal(row.fromAmount, '1.25');
  assert.equal(row.toAmount, '2.50');
});

for (const source of ['deposits', 'pending']) {
  test(`${source} routed deposits retain output token decimals`, async () => {
    const [row] = await recentRows({ [source]: [{ type: 'route', depositOutcome: 'route', finalToken: output, finalAmount: '250',
      DepositInfo: { stratoRecipient: 'ef'.repeat(20), stratoToken: input, stratoTokenAmount: '1250000', bridgeStatus: '4' } }] });
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
  assert.equal(rows[0].label, 'Trade');
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

test('recent deposits retain their bridge source when rendering colliding statuses', async () => {
  const rows = await recentRows({ deposits: ['legacy', 'external'].map(bridgeSource => ({
    bridgeSource, block_timestamp: '2026-09-28T00:00:00Z',
    DepositInfo: { bridgeStatus: '6', stratoTokenAmount: '1000000000000000000' },
  })) });
  assert.deepEqual(rows.map(row => row.status.text), ['On Hold', 'Refunded']);
});

 test('withdrawal-only activity shows five newest transfers, cancellation and refresh without deposits', async () => {
  const withdrawals = Array.from({ length: 7 }, (_, i) => ({ withdrawalId: String(i + 1), bridgeSource: i % 2 ? 'native' : 'external',
    block_timestamp: `2026-10-0${i + 1}T00:00:00Z`, externalSymbol: 'USDC', externalDecimals: 6,
    WithdrawalInfo: { stratoToken: input, stratoTokenAmount: '1000000', externalTokenAmount: '1000000',
      stratoSender: 'ef'.repeat(20), bridgeStatus: '1', externalChainId: '11155111', externalTxHash: '0x' + '1'.repeat(64) } }));
  const session = await recentSession({ withdrawalsOnly: true, withdrawals, pending: [{ type: 'route' }],
    fetchDeposits: async () => { throw new Error('must not fetch deposits'); } });
  const rows = session.render();
  assert.equal(rows.length, 5);
  assert.ok(rows.every(row => row.label === 'Bridge Out' && row.status.text === 'Requested'));
  assert.equal(rows[0].action.props.withdrawalId, '7');
  assert.match(rows[0].transactionUrl, /sepolia/);
  withdrawals[6].WithdrawalInfo.bridgeStatus = '4';
  session.tick(); await new Promise(setImmediate);
  assert.equal(session.render()[0].status.text, 'Completed');
  assert.equal(session.render()[0].action, undefined);
  session.close();
});
