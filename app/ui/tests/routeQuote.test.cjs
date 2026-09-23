const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { QueryClient, QueryObserver, keepPreviousData } = require('@tanstack/react-query');

for (const [name, inputs] of [
  ['useRouteQuote', { tokenIn: 'in', tokenOut: 'out', amountWei: '1', slippageBps: 50 }],
  ['useCompositeRouteQuote', { externalChainId: '1', externalToken: 'external',
    targetStratoToken: 'bridge', tokenOut: 'out', amountWei: '1', slippageBps: 50 }],
]) {
  test(`${name} never exposes a quote for previous inputs`, () => {
    const client = new QueryClient();
    let observer, unsubscribe;
    let debounced = '1';
    const exports = {};
    const source = fs.readFileSync(path.join(__dirname, `../src/hooks/trade/${name}.ts`), 'utf8');
    vm.runInNewContext(ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, {
      exports,
      require: (id) => {
        if (id === '@/hooks/useDebouncedValue') return { useDebouncedValue: () => debounced };
        if (id === '@/lib/axios') return { api: {} };
        assert.equal(id, '@tanstack/react-query');
        return { keepPreviousData, useQuery: (options) => {
          options = { ...options, enabled: false };
          if (!observer) {
            client.setQueryData(options.queryKey, { minFinalOut: '99' });
            observer = new QueryObserver(client, options);
            unsubscribe = observer.subscribe(() => {});
          } else observer.setOptions(options);
          return observer.getCurrentResult();
        } };
      },
    });
    const hook = exports[name];
    try {
      assert.equal(hook(inputs).data.minFinalOut, '99');
      // The old query is still current during debounce, but its data must be hidden.
      assert.equal(hook({ ...inputs, amountWei: '100' }).data, undefined);
      debounced = '100';
      assert.equal(hook({ ...inputs, amountWei: '100' }).data, undefined);
      debounced = '1';
      assert.equal(hook(inputs).data.minFinalOut, '99');
      for (const key of Object.keys(inputs).filter((key) => key !== 'amountWei')) {
        const result = hook({ ...inputs, [key]: key === 'slippageBps' ? 100 : 'different' });
        assert.equal(result.isPlaceholderData, true);
        assert.equal(result.data, undefined, key);
        assert.equal(hook(inputs).data.minFinalOut, '99');
      }
    } finally {
      unsubscribe?.();
      observer?.destroy();
      client.clear();
    }
  });
}

const utilsSource = ts.createSourceFile('utils.ts', fs.readFileSync(path.join(__dirname, '../src/lib/bridge/utils.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const validatorNode = utilsSource.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'assertAutoRouteQuote');
const validatorExports = {};
vm.runInNewContext(ts.transpileModule(validatorNode.getText(utilsSource), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: validatorExports });
const assertAutoRouteQuote = validatorExports.assertAutoRouteQuote;
const address = (digit) => digit.repeat(40);
const binding = { externalChainId: '1', externalToken: address('1'), targetStratoToken: address('2'),
  externalAmount: 100n, externalDecimals: 2, tokenOut: address('3'), slippageBps: 50 };
const composite = { tokenIn: address('2'), tokenOut: address('3'), amountIn: '100', amountOut: '200', minFinalOut: '199',
  slippageBps: 50, deadline: 2000, steps: [],
  bridge: { externalChainId: '1', externalToken: address('1'), targetStratoToken: address('2'), externalAmount: '100', externalDecimals: '2', bridgedAmount: '100' },
  depositAction: { action: 4, actionToken: address('3'), minFinalOut: '199' } };

test('binds bridge quotes to the selected tokens, amount, minimum and deadline', () => {
  assert.doesNotThrow(() => assertAutoRouteQuote(composite, binding, 1000));
  for (const mutate of [
    (q) => q.depositAction.actionToken = address('4'),
    (q) => q.tokenOut = address('4'),
    (q) => q.bridge.externalAmount = '101',
    (q) => q.bridge.externalChainId = '2',
    (q) => q.bridge.externalToken = address('4'),
    (q) => q.bridge.targetStratoToken = address('4'),
    (q) => q.amountIn = '101',
    (q) => q.deadline = 1000,
    (q) => q.slippageBps = 100,
    (q) => q.depositAction.minFinalOut = '0',
    (q) => { q.depositAction.minFinalOut = '1'; q.minFinalOut = '1'; },
    (q) => q.depositAction.action = 0,
  ]) {
    const changed = structuredClone(composite); mutate(changed);
    assert.throws(() => assertAutoRouteQuote(changed, binding, 1000));
  }
});

test('rechecks quote expiry after the Permit2 signing prompt and before deposit submission', async () => {
  let now = 1000;
  let writes = 0;
  let permitDeadline;
  const exports = {};
  const account = `0x${address('5')}`;
  const contractService = {
    validateRouterContract: async () => ({ isValid: true }), checkPermit2Approval: async () => ({ isApproved: true }),
    getPermit2Nonce: () => 1n, getPermit2Domain: () => ({}), getPermit2Types: () => ({}),
    createPermit2Message: (input) => { permitDeadline = input.deadline; return input; }, simulateDeposit: async () => {},
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/hooks/trade/useAutoRouteDeposit.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, structuredClone, Date: { now: () => now * 1000 }, require: (id) => {
    if (id === 'react') return { useState: () => [false, () => {}], useRef: (value) => ({ current: value }) };
    if (id === '@/hooks/use-toast') return { useToast: () => ({ toast: () => {} }) };
    if (id === 'wagmi') return { useAccount: () => ({ address: account, chainId: 1 }),
      useSwitchChain: () => ({}), useWriteContract: () => ({ writeContractAsync: async () => { writes++; } }),
      useSignTypedData: () => ({ signTypedDataAsync: async () => { now = 2001; return '0xsignature'; } }) };
    if (id === '@/context/UserContext') return { useUser: () => ({ externalEvmWalletAddress: account,
      isExternalEvmWalletConnected: true, isAppAuthenticated: true, stratoAddress: address('6') }) };
    if (id === '@/context/BridgeContext') return { useBridgeContext: () => ({ triggerDepositRefresh: () => {} }) };
    if (id === '@/lib/bridge/contractService') return contractService;
    if (id === '@/lib/bridge/constants') return { resolveViemChain: async () => ({ id: 1 }) };
    if (id === '@/lib/bridge/utils') return { assertAutoRouteQuote: (q, b) => assertAutoRouteQuote(q, b, now) };
    if (id === '@/utils/numberUtils') return { safeParseUnits: () => 100n, ensureHexPrefix: (value) => `0x${value.replace(/^0x/, '')}` };
    throw new Error(`Unexpected import ${id}`);
  } });
  await assert.rejects(exports.useAutoRouteDeposit().execute({ route: { externalToken: address('1'), stratoToken: address('2'), externalDecimals: '2' },
    network: { chainId: '1', depositRouter: address('7') }, amount: '1', quote: composite,
    outputAddress: address('3'), outputSymbol: 'OUT', slippageBps: 50 }), /Quote expired/);
  assert.equal(permitDeadline, 1900n);
  assert.equal(writes, 0);
});

const { WaitForTransactionReceiptTimeoutError } = require('viem');
const depositHash = `0x${'ab'.repeat(32)}`;
const approvalHash = `0x${'cd'.repeat(32)}`;
const receiptSource = ts.createSourceFile('contractService.ts', fs.readFileSync(path.join(__dirname, '../src/lib/bridge/contractService.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const receiptFunction = receiptSource.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'waitForTransaction');
const widgetSource = ts.createSourceFile('RouterWidget.tsx', fs.readFileSync(path.join(__dirname, '../src/components/router/RouterWidget.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let tradeHandler;
function findTradeHandler(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(widgetSource) === 'handleTrade') tradeHandler = node.initializer.getText(widgetSource);
  ts.forEachChild(node, findTradeHandler);
}
findTradeHandler(widgetSource);

function runSource(source, globals) {
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, globals);
}

const friendlyExports = {};
runSource(utilsSource.statements.filter(node => ts.isFunctionDeclaration(node) &&
  ['normalizeError', 'getFriendlyMessage'].includes(node.name?.text)).map(node => node.getText(utilsSource)).join('\n'),
  { exports: friendlyExports });

function depositHarness({ native = true, approval = false, outcome = 'success', storageUnavailable = false, rejected = false, approvalExpires = false } = {}) {
  let now = Date.now();
  let stored = JSON.stringify([{ externalTxHash: 'other', externalChainId: 1 }]);
  const records = () => JSON.parse(stored);
  const writes = [], toasts = [], pendingStates = [];
  let refreshed = 0, cleared = 0;
  const localStorage = {
    getItem: () => { if (storageUnavailable) throw new Error('Storage disabled'); return stored; },
    setItem: (key, value) => { stored = value; },
  };
  const receiptExports = {};
  runSource(receiptFunction.getText(receiptSource), { exports: receiptExports, getClient: async () => ({
    waitForTransactionReceipt: async ({ hash }) => {
      // The deposit must already be persisted before its receipt is available.
      assert.equal(records().some((record) => record.externalTxHash === depositHash), !approval && !storageUnavailable);
      assert.equal(hash, approval ? approvalHash : depositHash);
      if (outcome === 'timeout') throw new WaitForTransactionReceiptTimeoutError({ hash });
      if (outcome === 'rpc-error') throw new Error('RPC disconnected');
      if (approvalExpires) now += 1_000_000;
      return { status: outcome };
    },
  }) });
  const account = `0x${address('5')}`;
  const exports = {};
  runSource(fs.readFileSync(path.join(__dirname, '../src/hooks/trade/useAutoRouteDeposit.ts'), 'utf8'), {
    exports, structuredClone, localStorage, Date: class extends Date { static now() { return now; } }, require: (id) => {
      if (id === 'react') return { useState: () => [false, (value) => pendingStates.push(value)], useRef: (value) => ({ current: value }) };
      if (id === '@/hooks/use-toast') return { useToast: () => ({ toast: (value) => toasts.push(value) }) };
      if (id === 'wagmi') return {
        useAccount: () => ({ address: account, chainId: 1 }), useSwitchChain: () => ({}),
        useWriteContract: () => ({ writeContractAsync: async (params) => {
          if (rejected) throw new Error('User rejected request');
          writes.push(params.functionName);
          return params.functionName === 'approve' ? approvalHash : depositHash;
        } }),
        useSignTypedData: () => ({ signTypedDataAsync: async () => '0xsignature' }),
      };
      if (id === '@/context/UserContext') return { useUser: () => ({ externalEvmWalletAddress: account,
        isExternalEvmWalletConnected: true, isAppAuthenticated: true, stratoAddress: address('6') }) };
      if (id === '@/lib/bridge/contractService') return {
        validateRouterContract: async () => ({ isValid: true }), checkPermit2Approval: async () => ({ isApproved: !approval }),
        getPermit2Nonce: () => 1n, getPermit2Domain: () => ({}), getPermit2Types: () => ({}),
        createPermit2Message: (input) => input, simulateDeposit: async () => {}, ...receiptExports,
      };
      if (id === '@/lib/bridge/constants') return { resolveViemChain: async () => ({ id: 1 }) };
      if (id === '@/lib/bridge/utils') return { assertAutoRouteQuote };
      if (id === '@/utils/numberUtils') return { safeParseUnits: () => 100n, ensureHexPrefix: (value) => `0x${value.replace(/^0x/, '')}` };
      throw new Error(`Unexpected import ${id}`);
    },
  });
  const quote = structuredClone(composite);
  quote.deadline = Math.floor(Date.now() / 1000) + 600;
  if (native) quote.bridge.externalToken = address('0');
  const handlerExports = {};
  runSource(`exports.handleTrade = ${tradeHandler}`, {
    exports: handlerExports, quote, quoteLoading: false, pending: false,
    ...friendlyExports, amountError: '', feeError: '',
    tokenOut: { _symbol: 'OUT', address: address('3') }, amountWei: '100', externalBalanceError: false,
    sourceMode: 'external', externalRoute: { externalToken: quote.bridge.externalToken, stratoToken: address('2'), externalDecimals: '2' },
    network: { chainId: '1', depositRouter: address('7') }, compositeQuote: { data: quote },
    autoRouteDeposit: exports.useAutoRouteDeposit(), amount: '1', slippageBps: 50, toast: (value) => toasts.push(value),
    onTransactionSubmitted: () => { refreshed++; }, balanceEnabled: false,
    setAmount: (value) => { assert.equal(value, ''); cleared++; },
  });
  return { handleTrade: handlerExports.handleTrade, records, writes, toasts, pendingStates,
    refreshed: () => refreshed, cleared: () => cleared };
}

for (const native of [true, false]) {
  for (const outcome of ['success', 'reverted', 'timeout', 'rpc-error']) {
    test(`${native ? 'ETH' : 'ERC20'} deposit receipt ${outcome} preserves the correct submission state`, async () => {
      const harness = depositHarness({ native, outcome });
      await harness.handleTrade();
      assert.deepEqual(harness.writes, [native ? 'depositETHWithAction' : 'depositWithAction']);
      assert.deepEqual(harness.pendingStates, [true, false]);
      assert.equal(harness.records()[0].externalTxHash, 'other');
      assert.equal(harness.records().length, outcome === 'reverted' ? 1 : 2);
      if (outcome !== 'reverted') assert.equal(harness.records()[1].finalToken, address('3'));
      assert.equal(harness.toasts.length, 1);
      const toast = harness.toasts[0];
      if (outcome === 'reverted') {
        assert.equal(toast.title, 'Transaction failed');
        assert.match(toast.description, /reverted/);
      } else if (outcome === 'success') {
        assert.equal(toast.title, 'Deposit submitted');
        assert.equal(toast.variant, 'success');
      } else {
        assert.equal(toast.title, 'Deposit still pending');
        assert.match(toast.description, /do not resubmit/);
        assert.ok(toast.description.includes(depositHash));
        assert.notEqual(toast.variant, 'destructive');
        assert.equal(toast.duration, Infinity);
      }
      assert.equal(harness.refreshed(), outcome === 'reverted' ? 0 : 1);
      assert.equal(harness.cleared(), outcome === 'reverted' ? 0 : 1);
    });
  }
}

for (const outcome of ['timeout', 'rpc-error', 'reverted']) {
  test(`approval receipt ${outcome} never submits or records a deposit`, async () => {
    const harness = depositHarness({ native: false, approval: true, outcome });
    await harness.handleTrade();
    assert.deepEqual(harness.writes, ['approve']);
    assert.equal(harness.records().length, 1);
    assert.equal(harness.refreshed(), 0);
    assert.equal(harness.cleared(), 0);
    assert.equal(harness.toasts[0].title, outcome === 'reverted' ? 'Transaction failed' : 'Approval still pending');
    if (outcome !== 'reverted') {
      assert.match(harness.toasts[0].description, /No deposit has been sent/);
      assert.ok(harness.toasts[0].description.includes(approvalHash));
    }
  });
}

test('receipt timeout remains pending when local history storage fails', async () => {
  const harness = depositHarness({ outcome: 'timeout', storageUnavailable: true });
  await harness.handleTrade();
  assert.equal(harness.toasts[0].title, 'Deposit submitted; local history unavailable');
  assert.equal(harness.toasts[1].title, 'Deposit still pending');
  assert.equal(harness.refreshed(), 1);
  assert.equal(harness.cleared(), 1);
});

test('a wallet rejection remains a failure without a pending deposit', async () => {
  const harness = depositHarness({ rejected: true });
  await harness.handleTrade();
  assert.equal(harness.records().length, 1);
  assert.equal(harness.toasts[0].title, 'Transaction failed');
  assert.match(harness.toasts[0].description, /Transaction cancelled/);
});

for (const [name, isLoggedIn, isAppAuthenticated, expectedSubmissions] of [
  ['MetaMask-only user', true, false, 1],
  ['app-authenticated user', true, true, 1],
  ['disconnected guest', false, false, 0],
]) {
  test(`STRATO trade authentication supports ${name}`, async () => {
    const exports = {};
    const submissions = [];
    runSource(`exports.handleTrade = ${tradeHandler}`, {
      exports, ...friendlyExports, amountError: '', feeError: '', fetchUsdstBalance: async () => {},
      isLoggedIn, isAppAuthenticated, sourceMode: 'strato',
      quote: { minFinalOut: '90' }, quoteLoading: false, pending: false,
      tokenIn: { address: address('1'), _symbol: 'IN' }, tokenOut: { address: address('2') },
      amount: '1', amountWei: '100', slippageBps: 50, externalBalanceError: '', balanceEnabled: false,
      routeExecute: { mutateAsync: async (params) => { submissions.push(params); } },
      toast: (value) => assert.equal(value.title, 'Trade submitted'),
      onTransactionSubmitted: undefined, setAmount: () => {},
    });
    await exports.handleTrade();
    assert.equal(submissions.length, expectedSubmissions);
    if (expectedSubmissions) assert.equal(submissions[0].amountIn, '100');
  });
}

test('expired quote after mined approval explains approval reuse and sends no deposit', async () => {
  const harness = depositHarness({ native: false, approval: true, approvalExpires: true });
  await harness.handleTrade();
  assert.deepEqual(harness.writes, ['approve']);
  assert.match(harness.toasts[0].description, /approval succeeded and is reusable/);
  assert.match(harness.toasts[0].description, /No deposit was sent/);
  assert.equal(harness.records().length, 1);
});

test('native deposit reserves estimated gas before wallet submission', async () => {
  const fn = receiptSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'simulateDeposit');
  let balance = 123n, simulations = 0;
  const exports = {};
  runSource(fn.getText(receiptSource), { exports, DEPOSIT_ROUTER_ABI: [], formatAddress: value => value,
    getClient: async () => ({ estimateContractGas: async () => 10n, estimateFeesPerGas: async () => ({ maxFeePerGas: 2n }),
      getBalance: async () => balance, simulateContract: async () => { simulations++; } }) });
  const input = { depositRouter: address('1'), isNative: true, amount: 100n, userAddress: address('2'),
    targetStratoToken: address('3'), account: address('4'), chainId: '1' };
  await assert.rejects(exports.simulateDeposit(input), /deposit and gas fees/);
  assert.equal(simulations, 0);
  balance = 124n;
  await exports.simulateDeposit(input);
  assert.equal(simulations, 1);
});

for (const alreadyShown of [false, true]) {
  test(`failed STRATO trade refreshes fee balances and ${alreadyShown ? 'avoids duplicate' : 'shows friendly'} toast`, async () => {
    let refreshed = 0;
    const toasts = [], exports = {};
    runSource(`exports.handleTrade = ${tradeHandler}`, {
      exports, ...friendlyExports, isLoggedIn: true, sourceMode: 'strato',
      quote: { minFinalOut: '90' }, quoteLoading: false, pending: false,
      tokenIn: { address: address('1') }, tokenOut: { address: address('2') },
      amount: '1', amountWei: '100', amountError: '', feeError: '', externalBalanceError: '', slippageBps: 50,
      routeExecute: { mutateAsync: async () => { const err = new Error('backend internals'); err.toastShown = alreadyShown; throw err; } },
      fetchUsdstBalance: async () => { refreshed++; }, toast: value => toasts.push(value),
    });
    await exports.handleTrade();
    assert.equal(refreshed, 1);
    assert.equal(toasts.length, alreadyShown ? 0 : 1);
    if (!alreadyShown) assert.doesNotMatch(toasts[0].description, /backend internals/);
  });
}

test('route asset dropdown deduplicates prefixed and differently cased bridge tokens', () => {
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(widgetSource) === 'routeAssets') initializer = node.initializer.getText(widgetSource);
    ts.forEachChild(node, visit);
  }
  visit(widgetSource);
  const exports = {};
  runSource(`exports.assets = ${initializer}`, { exports, useMemo: fn => fn(),
    bridgeableTokens: [{ routeType: 'standard', depositsEnabled: true, stratoToken: `0x${'AB'.repeat(20)}` }],
    routeAssetsQuery: { data: [{ address: 'ab'.repeat(20), _symbol: 'REAL', customDecimals: 6 }] } });
  assert.equal(exports.assets.length, 1);
  assert.equal(exports.assets[0].customDecimals, 6);
  assert.equal(exports.assets[0].address, 'ab'.repeat(20));
});
