const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { QueryClient, QueryObserver, keepPreviousData } = require('@tanstack/react-query');

const bridgeConstants = {};
const bridgeConstantsSource = ts.createSourceFile('constants.ts', fs.readFileSync(path.join(__dirname, '../src/lib/bridge/constants.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const scopeDeclaration = bridgeConstantsSource.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(bridgeConstantsSource) === 'BRIDGE_SCOPES'));
runSource(scopeDeclaration.getText(bridgeConstantsSource), { exports: bridgeConstants });

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
    if (id === '@/lib/bridge/constants') return { ...bridgeConstants, resolveViemChain: async () => ({ id: 1 }) };
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
// Fee-balance readiness lives in the shared useFeeBalancesReady hook.
const feeHookSource = ts.createSourceFile('useTradeTokens.ts', fs.readFileSync(path.join(__dirname, '../src/hooks/trade/useTradeTokens.ts'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let tradeHandler, reviewHandler;
function findTradeHandler(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(widgetSource) === 'handleTrade') tradeHandler = node.initializer.getText(widgetSource);
  if (ts.isVariableDeclaration(node) && node.name.getText(widgetSource) === 'reviewTrade') reviewHandler = node.initializer.getText(widgetSource);
  ts.forEachChild(node, findTradeHandler);
}
findTradeHandler(widgetSource);

function runSource(source, globals) {
  vm.runInNewContext(ts.transpileModule(source, {
    fileName: 'test.tsx',
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, globals);
}

const routeHelpers = {};
runSource(fs.readFileSync(path.join(__dirname, '../src/lib/route.ts'), 'utf8'), { exports: routeHelpers });
function confirmedTrade(quote) {
  return { ...routeHelpers, minDepositError: "", depositConfigReady: true, fetchTokens: async () => {}, getEarningAssets: async () => {}, confirming: { current: false }, selectionError: undefined,
    selectionKey: 'selected', confirmation: { selectionKey: 'selected', quote: {
      deadline: Math.floor(Date.now() / 1000) + 600, ...quote,
    } }, setConfirmation: () => {} };
}

const friendlyExports = {};
runSource(utilsSource.statements.filter(node => ts.isFunctionDeclaration(node) &&
  ['normalizeError', 'getFriendlyMessage', 'getQuoteErrorMessage'].includes(node.name?.text)).map(node => node.getText(utilsSource)).join('\n'),
  { exports: friendlyExports });

test('quote errors use the API reason without claiming a transaction failed or exposing server details', () => {
  for (const message of ['No route found for a -> b', 'No executable route found for a -> b']) {
    for (const data of [{ error: { message } }, { error: message }, { message }]) {
      const result = friendlyExports.getQuoteErrorMessage({ message: 'Request failed with status code 422', response: { status: 422, data } });
      assert.equal(result, 'No route is available for this amount. Try a different amount or token.');
    }
  }
  for (const error of [
    { response: { status: 500, data: { error: { message: 'internal SQL credentials' } } } },
    { response: { status: 500, data: { error: { message: 'No route found in broken infrastructure' } } } },
    { message: 'Unexpected backend response' },
    null,
  ]) assert.equal(friendlyExports.getQuoteErrorMessage(error), 'Quote unavailable. Please try again.');
  assert.match(friendlyExports.getQuoteErrorMessage({ message: 'Network Error' }), /Check your connection/);
  assert.match(friendlyExports.getQuoteErrorMessage({ message: 'timeout of 30000ms exceeded' }), /Quote request timed out/);
});

test('route rejection reasons give actionable messages without echoing backend data', () => {
  const error = (rejections, status = 422) => ({ response: { status, data: { error: {
    message: 'No executable route found for a -> b', details: { rejections },
  } } } });
  for (const [reason, message] of [
    ['PARTIAL_FILL', /liquidity.*smaller amount/],
    ['INSUFFICIENT_LIQUIDITY', /liquidity.*smaller amount/],
    ['CAPACITY_LIMIT', /deposit or mint limit/],
    ['AMOUNT_TOO_SMALL', /larger amount/],
    ['POOL_UNAVAILABLE', /paused or disabled/],
    ['QUOTE_UNAVAILABLE', /data is unavailable/],
    ['POOL_REUSE', /No route is available/],
    ['NO_POOL', /No route is available/],
  ]) assert.match(friendlyExports.getQuoteErrorMessage(error([{ reason }])), message);
  const repeated = friendlyExports.getQuoteErrorMessage(error([
    { reason: 'PARTIAL_FILL' }, { reason: 'INSUFFICIENT_LIQUIDITY' },
  ]));
  assert.equal(repeated.match(/liquidity/g).length, 1);
  assert.equal(friendlyExports.getQuoteErrorMessage(error([{ reason: 'private credentials' }, null])),
    'No route is available for this amount. Try a different amount or token.');
  assert.equal(friendlyExports.getQuoteErrorMessage(error([{ reason: 'CAPACITY_LIMIT' }], 500)),
    'Quote unavailable. Please try again.');
});

test('STRATO pool registration errors remain actionable for API and wallet failures', () => {
  const message = 'solidity require failed: TR: unregistered v2 pool';
  const normalized = friendlyExports.normalizeError({
    message: 'Request failed with status code 400',
    response: { status: 400, data: { error: { message } } },
  });
  assert.equal(normalized.message, message);
  assert.match(normalized.userMessage, /selected pool is not recognized/);
  assert.equal(friendlyExports.getFriendlyMessage(message), normalized.userMessage);
  const serverError = friendlyExports.normalizeError({ response: { status: 500, data: { error: { message } } } });
  assert.equal(serverError.userMessage, 'Something went wrong. Please try again later.');
});

function depositHarness({ native = true, redemption = false, routedRedemption = false, approval = false, outcome = 'success', storageUnavailable = false, rejected = false, approvalExpires = false,
  appAuthenticated = true, code, codeError = false, changeIdentityAt, mutateIdentity } = {}) {
  let now = Date.now();
  let stored = JSON.stringify([{ externalTxHash: 'other', externalChainId: 1 }]);
  const records = () => JSON.parse(stored);
  const writes = [], writeParams = [], toasts = [], pendingStates = [], stages = [];
  const codeChecks = [];
  const refs = [];
  let refIndex = 0;
  const account = `0x${address('5')}`;
  const wallet = { address: account, chainId: 1 };
  const user = { externalEvmWalletAddress: account, isExternalEvmWalletConnected: true,
    isAppAuthenticated: appAuthenticated, stratoAddress: address('6') };
  const stage = (name) => {
    if (name !== changeIdentityAt) return;
    mutateIdentity(user, wallet);
    renderHook();
  };
  let refreshed = 0, cleared = 0;
  const localStorage = {
    getItem: () => { if (storageUnavailable) throw new Error('Storage disabled'); return stored; },
    setItem: (key, value) => { assert.equal(key, bridgeConstants.BRIDGE_SCOPES.trade.pendingDepositsKey); stored = value; },
  };
  const receiptExports = {};
  runSource(receiptFunction.getText(receiptSource), { exports: receiptExports, getClient: async () => ({
    waitForTransactionReceipt: async ({ hash }) => {
      // The deposit must already be persisted before its receipt is available.
      assert.equal(records().some((record) => record.externalTxHash === depositHash), hash !== approvalHash && !storageUnavailable);
      assert.ok(hash === approvalHash || hash === depositHash);
      if (outcome === 'timeout') throw new WaitForTransactionReceiptTimeoutError({ hash });
      if (outcome === 'rpc-error') throw new Error('RPC disconnected');
      if (approvalExpires) now += 1_000_000;
      stage('approval');
      return { status: outcome };
    },
  }) });
  const guardExports = {};
  const guard = receiptSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'assertExternalWalletRecipient');
  const constantsSource = fs.readFileSync(path.join(__dirname, '../src/lib/bridge/constants.ts'), 'utf8');
  runSource(`${constantsSource.match(/export const EIP7702_DELEGATION_CODE_PATTERN = .*;/)[0]}
    ${guard.getText(receiptSource)}`, { exports: guardExports, formatAddress: value => value,
    getClient: async chainId => ({ getCode: async ({ address }) => {
      codeChecks.push({ address, chainId });
      if (codeError) throw new Error('RPC unavailable');
      return code;
    } }) });
  const exports = {};
  runSource(fs.readFileSync(path.join(__dirname, '../src/hooks/trade/useAutoRouteDeposit.ts'), 'utf8'), {
    exports, structuredClone, localStorage, Date: class extends Date { static now() { return now; } }, require: (id) => {
      if (id === 'react') return { useState: initial => [initial, (value) => (initial === false ? pendingStates : stages).push(value)],
        useRef: (value) => refs[refIndex++] ?? (refs[refIndex - 1] = { current: value }) };
      if (id === '@/hooks/use-toast') return { useToast: () => ({ toast: (value) => toasts.push(value) }) };
      if (id === 'wagmi') return {
        useAccount: () => ({ ...wallet }), useSwitchChain: () => ({}),
        useWriteContract: () => ({ writeContractAsync: async (params) => {
          if (rejected) throw new Error('User rejected request');
          writes.push(params.functionName);
          writeParams.push(params);
          return params.functionName === 'approve' ? approvalHash : depositHash;
        } }),
        useSignTypedData: () => ({ signTypedDataAsync: async () => { assert.equal(redemption, false); stage('signature'); return '0xsignature'; } }),
      };
      if (id === '@/context/UserContext') return { useUser: () => ({ ...user }) };
      if (id === '@/lib/bridge/contractService') return {
        ...guardExports,
        validateRouterContract: async () => { assert.equal(redemption, false); stage('validation'); return { isValid: true }; }, checkPermit2Approval: async () => ({ isApproved: !approval }),
        checkTokenApproval: async params => { assert.equal(params.spender, address('8')); return { isApproved: !approval }; },
        simulateNativeRedemption: async params => { assert.equal(params.bridge, address('8')); assert.equal(params.amount, 100n); stage('simulation'); },
        getPermit2Nonce: () => 1n, getPermit2Domain: () => ({}), getPermit2Types: () => ({}),
        createPermit2Message: (input) => input, simulateDeposit: async () => { stage('simulation'); }, ...receiptExports,
      };
      if (id === '@/lib/bridge/constants') return { ...bridgeConstants, resolveViemChain: async () => ({ id: 1 }) };
      if (id === '@/lib/bridge/utils') return { assertAutoRouteQuote };
      if (id === '@/utils/numberUtils') return { safeParseUnits: () => 100n, ensureHexPrefix: (value) => `0x${value.replace(/^0x/, '')}` };
      throw new Error(`Unexpected import ${id}`);
    },
  });
  function renderHook() {
    refIndex = 0;
    return exports.useAutoRouteDeposit();
  }
  const quote = structuredClone(composite);
  quote.deadline = Math.floor(Date.now() / 1000) + 600;
  if (native) quote.bridge.externalToken = address('0');
  if (redemption) {
    if (!routedRedemption) Object.assign(quote, { tokenOut: address('2'), amountOut: '100', minFinalOut: '100' });
    Object.assign(quote.bridge, { routeType: 'native', externalBridge: address('8'), externalToken: address('1') });
    if (!routedRedemption) quote.depositAction = { action: 0, actionToken: address('2'), minFinalOut: '100' };
  }
  const handlerExports = {};
  runSource(`exports.handleTrade = ${tradeHandler}`, {
    exports: handlerExports, ...confirmedTrade(quote), quote, quoteLoading: false, pending: false,
    ...friendlyExports, amountError: '', feeError: '',
    tokenOut: { _symbol: 'OUT', address: quote.tokenOut }, amountWei: '100', externalBalanceError: false,
    sourceMode: 'external', externalRoute: { externalSymbol: 'USDC', externalToken: quote.bridge.externalToken, stratoToken: address('2'), externalDecimals: '2',
      ...(redemption ? { routeType: 'native', externalBridge: address('8') } : {}) },
    network: { chainId: '1', depositRouter: redemption ? undefined : address('7') }, compositeQuote: { data: quote },
    autoRouteDeposit: renderHook(), amount: '1', slippageBps: 50, toast: (value) => toasts.push(value),
    onTransactionSubmitted: () => { refreshed++; }, balanceEnabled: false,
    setAmount: (value) => { assert.equal(value, ''); cleared++; },
  });
  return { handleTrade: handlerExports.handleTrade, records, writes, writeParams, toasts, pendingStates, stages, codeChecks,
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

for (const [label, code] of [['EOA', undefined], ['empty bytecode', '0x'],
  ['delegated EOA', `0xef0100${address('a')}`]]) {
  test(`wallet-only deposit supports ${label} and pins its recipient`, async () => {
    const harness = depositHarness({ appAuthenticated: false, code });
    await harness.handleTrade();
    assert.deepEqual(harness.writes, ['depositETHWithAction']);
    assert.deepEqual(harness.codeChecks, [{ address: `0x${address('5')}`, chainId: '1' }]);
    assert.equal(harness.records()[1].DepositInfo.stratoRecipient, `0x${address('5')}`);
  });
}

for (const native of [true, false]) {
  test(`${native ? 'ETH' : 'ERC20'} contract-wallet recipient is blocked before approval or deposit`, async () => {
    const harness = depositHarness({ native, approval: !native, appAuthenticated: false, code: '0x60806040' });
    await harness.handleTrade();
    assert.deepEqual(harness.writes, []);
    assert.equal(harness.records().length, 1);
    assert.match(harness.toasts[0].description, /contract wallet cannot receive/);
  });
}

test('recipient verification fails closed on RPC errors and malformed delegation code', async () => {
  for (const options of [{ codeError: true }, { code: '0xef0100' }, { code: `0xef0100${address('a')}00` }]) {
    const harness = depositHarness({ appAuthenticated: false, ...options });
    await harness.handleTrade();
    assert.deepEqual(harness.writes, []);
    assert.equal(harness.records().length, 1);
    assert.match(harness.toasts[0].description, options.codeError ? /Unable to verify/ : /contract wallet cannot receive/);
  }
});

test('an app-authenticated deposit keeps the STRATO recipient without rejecting its external contract wallet', async () => {
  const harness = depositHarness({ code: '0x60806040' });
  await harness.handleTrade();
  assert.deepEqual(harness.codeChecks, []);
  assert.deepEqual(harness.writes, ['depositETHWithAction']);
  assert.equal(harness.records()[1].DepositInfo.stratoRecipient, address('6'));
});

for (const [label, native, approval, stage, mutateIdentity] of [
  ['session expiry after approval', false, true, 'approval', user => { user.isAppAuthenticated = false; user.stratoAddress = null; }],
  ['session expiry while signing', false, false, 'signature', user => { user.isAppAuthenticated = false; user.stratoAddress = null; }],
  ['session expiry during native simulation', true, false, 'simulation', user => { user.isAppAuthenticated = false; user.stratoAddress = null; }],
  ['STRATO recipient change', true, false, 'validation', user => { user.stratoAddress = address('8'); }],
  ['wallet account switch', false, false, 'signature', (_user, wallet) => { wallet.address = `0x${address('8')}`; }],
  ['external sender change', false, false, 'signature', user => { user.externalEvmWalletAddress = `0x${address('8')}`; }],
  ['wallet disconnect', true, false, 'validation', user => { user.isExternalEvmWalletConnected = false; }],
]) {
  test(`${label} aborts before broadcasting a deposit`, async () => {
    const harness = depositHarness({ native, approval, changeIdentityAt: stage, mutateIdentity });
    await harness.handleTrade();
    assert.deepEqual(harness.writes, approval ? ['approve'] : []);
    assert.equal(harness.records().length, 1);
    assert.match(harness.toasts[0].description, /wallet or sign-in session changed/);
    assert.deepEqual(harness.pendingStates, [true, false]);
  });
}

test('Trade loads and polls fee balances for the current account and cancels obsolete updates', async () => {
  let effect, dependencies, cleanup, timer, cleared = false;
  const requests = [], owners = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(feeHookSource) === 'useEffect' &&
        node.arguments[0].getText(feeHookSource).includes('fetchUsdstBalance')) effect = node.getText(feeHookSource);
    ts.forEachChild(node, visit);
  }
  visit(feeHookSource);
  const fetchUsdstBalance = signal => new Promise(resolve => requests.push({ signal, resolve }));
  const mount = (isLoggedIn, userAddress) => runSource(effect, {
    isLoggedIn, userAddress, fetchUsdstBalance, AbortController, USDST_BALANCE_REFRESH_MS: 10000,
    setFeeBalanceOwner: owner => owners.push(owner),
    useEffect: (fn, deps) => { dependencies = deps; cleanup = fn(); },
    setInterval: (fn, ms) => { assert.equal(ms, 10000); timer = fn; return 123; },
    clearInterval: id => { assert.equal(id, 123); cleared = true; },
  });
  mount(false, null);
  assert.equal(requests.length, 0);
  mount(true, 'first');
  assert.equal(requests.length, 1, 'direct navigation fetches immediately');
  assert.deepEqual(Array.from(dependencies), [true, 'first', fetchUsdstBalance]);
  requests[0].resolve();
  await new Promise(setImmediate);
  assert.deepEqual(owners, ['first']);
  const refresh = timer();
  assert.equal(requests.length, 2);
  cleanup();
  assert.equal(cleared, true);
  assert.equal(requests[1].signal.aborted, true);
  mount(true, 'second');
  requests[1].resolve();
  await refresh;
  assert.deepEqual(owners, ['first'], 'the old account cannot become ready after cleanup');
  requests[2].resolve();
  await new Promise(setImmediate);
  assert.deepEqual(owners, ['first', 'second']);
  cleanup();
});

test('STRATO trading waits for fee balances instead of interpreting initial zeroes as insufficient funds', async () => {
  const expressions = {};
  function visit(node, file) {
    if (ts.isVariableDeclaration(node) && ['feeBalancesReady', 'feeError', 'usdFeePortion', 'maxSpendableWei'].includes(node.name.getText(file)) &&
        node.initializer && !node.initializer.getText(file).includes('useFeeBalancesReady')) {
      expressions[node.name.getText(file)] = node.initializer.getText(file);
    }
    ts.forEachChild(node, child => visit(child, file));
  }
  visit(widgetSource, widgetSource);
  visit(feeHookSource, feeHookSource);
  const evaluate = (overrides = {}) => {
    const exports = {};
    runSource(`const feeBalancesReady = ${expressions.feeBalancesReady};
      const usdFeePortion = ${expressions.usdFeePortion};
      exports.ready = feeBalancesReady; exports.error = ${expressions.feeError};
      exports.max = ${expressions.maxSpendableWei};`, {
      exports, SWAP_FEE: '0.02', formatUnits: require('ethers').formatUnits, userAddress: 'user', feeBalanceOwner: null, loadingUsdstBalance: false,
      guestMode: false, sourceMode: 'strato', availableFees: 0n, routeFeeWei: 2n, usdstBalanceError: null,
      voucherBalance: '0', inputBalance: 100n, tokenIn: { address: 'usdst' }, usdstAddress: 'usdst',
      ...overrides,
    });
    return exports;
  };
  assert.equal(evaluate().ready, false);
  assert.equal(evaluate().error, '');
  assert.equal(evaluate({ feeBalanceOwner: 'other' }).ready, false);
  assert.equal(evaluate({ loadingUsdstBalance: true }).ready, false);
  assert.equal(evaluate({ loadingUsdstBalance: true }).error, '');
  assert.match(evaluate({ feeBalanceOwner: 'user' }).error, /You need/);
  const loaded = evaluate({ feeBalanceOwner: 'user', availableFees: 2n, voucherBalance: '2' });
  assert.equal(loaded.ready, true);
  assert.equal(loaded.error, '');
  assert.equal(loaded.max, '100', 'loaded vouchers preserve the USDST input balance');
  assert.deepEqual(evaluate({ feeBalanceOwner: 'user', availableFees: 2n, voucherBalance: '2', loadingUsdstBalance: true }),
    loaded, 'background refresh keeps the loaded account ready');
  assert.match(evaluate({ feeBalanceOwner: 'user', loadingUsdstBalance: true }).error, /You need/);
  const exports = {};
  runSource(`exports.handleTrade = ${tradeHandler}`, {
    exports, ...confirmedTrade({}), sourceMode: 'strato', isLoggedIn: true, feeBalancesReady: false,
    quote: {}, quoteLoading: false, pending: false, tokenIn: {}, tokenOut: {}, amountWei: '100',
    amountError: '', feeError: '', externalBalanceError: '',
    routeExecute: { mutateAsync: () => assert.fail('must not trade before fee balances load') },
  });
  await exports.handleTrade();
});

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
      exports, ...confirmedTrade({ minFinalOut: '90' }), ...friendlyExports, amountError: '', feeError: '', fetchUsdstBalance: async () => {},
      isLoggedIn, isAppAuthenticated, sourceMode: 'strato', feeBalancesReady: true,
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
  test(`failed STRATO trade refreshes fee balances and leaves feedback to progress dialog (toastShown=${alreadyShown})`, async () => {
    let refreshed = 0, tokensRefreshed = 0, earningsRefreshed = 0;
    const toasts = [], exports = {};
    runSource(`exports.handleTrade = ${tradeHandler}`, {
      exports, ...confirmedTrade({ minFinalOut: '90' }), ...friendlyExports, isLoggedIn: true, sourceMode: 'strato', feeBalancesReady: true,
      quote: { minFinalOut: '90' }, quoteLoading: false, pending: false,
      tokenIn: { address: address('1') }, tokenOut: { address: address('2') },
      amount: '1', amountWei: '100', amountError: '', feeError: '', externalBalanceError: '', slippageBps: 50,
      routeExecute: { mutateAsync: async () => { const err = new Error('backend internals'); err.toastShown = alreadyShown; throw err; } },
      fetchTokens: async () => { tokensRefreshed++; }, getEarningAssets: async () => { earningsRefreshed++; },
      fetchUsdstBalance: async () => { refreshed++; }, toast: value => toasts.push(value),
    });
    await exports.handleTrade();
    assert.equal(refreshed, 1);
    assert.equal(tokensRefreshed, 1);
    assert.equal(earningsRefreshed, 1);
    assert.equal(toasts.length, 0);
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
    bridgeableTokens: [{ routeType: 'standard', enabled: true, depositsEnabled: true, stratoToken: `0x${'AB'.repeat(20)}` }],
    routeAssetsQuery: { data: [{ address: 'ab'.repeat(20), _symbol: 'REAL', customDecimals: 6 }] } });
  assert.equal(exports.assets.length, 1);
  assert.equal(exports.assets[0].customDecimals, 6);
  assert.equal(exports.assets[0].address, 'ab'.repeat(20));
});

test('deep links normalize addresses, respect explicit tokens and orient pool pairs', () => {
  const tokens = ['a', 'b', 'c'].map(digit => ({ address: address(digit), _symbol: digit.toUpperCase() }));
  const select = (input, output, pool = []) => routeHelpers.resolveRouteSelection(tokens, tokens, input, output, pool);
  const selected = select(`0x${address('C')}`, `0x${address('A')}`, [address('a'), address('b')]);
  assert.equal(selected.tokenIn, tokens[2]);
  assert.equal(selected.tokenOut, tokens[0]);
  const pool = [address('a'), address('b'), address('c')];
  assert.equal(select('', '', pool).tokenIn, tokens[0]);
  assert.equal(select('', '', pool).tokenOut, tokens[1]);
  assert.equal(select('', address('a'), pool).tokenIn, tokens[1]);
  assert.equal(select(address('c'), '', pool).tokenOut, tokens[0]);
  assert.match(select(address('a'), `0x${address('A')}`).error, /different/);
  for (const input of ['bad-address', address('d')]) {
    assert.match(select(input, address('b')).error, /unavailable/);
    assert.equal(select(input, address('b')).tokenIn, undefined);
  }
  assert.equal(routeHelpers.resolveRouteSelection([], [], address('b'), address('c')).tokenIn, undefined);
  assert.equal(select(address('b'), address('c')).tokenIn, tokens[1], 'async asset arrival preserves requested tokens');
});

test('review freezes the quote and does not submit a transaction', async () => {
  const quote = { ...structuredClone(composite), deadline: Math.floor(Date.now() / 1000) + 600 };
  let confirmation;
  const exports = {};
  runSource(`exports.review = ${reviewHandler}`, {
    exports, ...routeHelpers, structuredClone, quote, quoteLoading: false, pending: false, guestMode: false,
    recipient: address('5'), selectionKey: 'selected', sourceMode: 'strato', feeBalancesReady: true,
    tokenIn: { address: address('2'), _symbol: 'IN' }, tokenOut: { address: address('3'), _symbol: 'OUT' },
    minDepositError: '', depositConfigReady: true, inputDecimals: 18, amountWei: '100', amountError: '', feeError: '', externalBalanceError: '', selectionError: undefined,
    tokens: [], setConfirmation: value => { confirmation = value; },
    routeExecute: { mutateAsync: () => assert.fail('review cannot submit') },
  });
  exports.review();
  assert.equal(confirmation.quote.minFinalOut, '199');
  quote.minFinalOut = '150';
  assert.equal(confirmation.quote.minFinalOut, '199', 'refresh cannot change the displayed minimum');
  assert.equal(confirmation.recipient, address('5'));
});

test('confirmed submission uses the reviewed minimum during refresh and prevents duplicate clicks', async () => {
  let finish;
  const submissions = [];
  const state = confirmedTrade({ minFinalOut: '199' });
  state.confirmation.recipient = address('5');
  const exports = {};
  runSource(`exports.handleTrade = ${tradeHandler}`, {
    exports, ...state, ...friendlyExports, quote: { minFinalOut: '100' }, quoteLoading: true,
    sourceMode: 'strato', isLoggedIn: true, feeBalancesReady: true, pending: false,
    tokenIn: { address: address('2'), _symbol: 'IN' }, tokenOut: { address: address('3') },
    amount: '1', amountWei: '100', slippageBps: 50, amountError: '', feeError: '', externalBalanceError: '',
    routeExecute: { mutateAsync: params => { submissions.push(params); return new Promise(resolve => { finish = resolve; }); } },
    fetchUsdstBalance: async () => {}, toast: () => {}, onTransactionSubmitted: undefined,
    balanceEnabled: false, setAmount: () => {},
  });
  const first = exports.handleTrade();
  await exports.handleTrade();
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].minFinalOut, '199');
  assert.equal(submissions[0].recipient, address('5'));
  finish();
  await first;
});

test('a fee balance failure after review explains why confirmation cannot submit', async () => {
  const state = confirmedTrade({ minFinalOut: '199' });
  const toasts = [], exports = {};
  let closed = false;
  const feeError = 'You need 0.02 USDST for fees; you have 0 including vouchers.';
  runSource(`exports.handleTrade = ${tradeHandler}`, {
    exports, ...state, ...friendlyExports, pending: false,
    tokenOut: { address: address('3') }, amountWei: '100', amountError: '', feeError,
    routeExecute: { mutateAsync: () => assert.fail('must not submit') },
    autoRouteDeposit: { execute: () => assert.fail('must not deposit') },
    toast: value => toasts.push(value), setConfirmation: value => { closed = value === null; },
  });
  await exports.handleTrade();
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].title, 'Quote unavailable');
  assert.equal(toasts[0].description, feeError);
  assert.equal(closed, true);
  assert.equal(state.confirming.current, false);
});

for (const reason of ['no confirmation', 'expired', 'selection changed']) {
  test(`${reason} cannot broadcast from the confirmation dialog`, async () => {
    const state = confirmedTrade({ deadline: reason === 'expired' ? 0 : Math.floor(Date.now() / 1000) + 600 });
    if (reason === 'no confirmation') state.confirmation = null;
    if (reason === 'selection changed') state.selectionKey = 'changed-account-or-input';
    const toasts = [], exports = {};
    runSource(`exports.handleTrade = ${tradeHandler}`, {
      exports, ...state, ...friendlyExports, pending: false,
      routeExecute: { mutateAsync: () => assert.fail('must not submit') },
      autoRouteDeposit: { execute: () => assert.fail('must not deposit') }, toast: value => toasts.push(value),
    });
    await exports.handleTrade();
    assert.equal(toasts.length, reason === 'no confirmation' ? 0 : 1);
    if (toasts.length) assert.match(toasts[0].description, reason === 'expired' ? /Quote expired/ : /changed/);
  });
}

test('STRATO execution reports wallet steps and retains terminal results without replaying the trade', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/hooks/trade/useRouteExecute.ts'), 'utf8');
  for (const outcome of ['wallet success', 'account success', 'account response lost', 'account rejected', 'pending', 'rejected', 'reverted', 'failure response', 'confirmation unavailable']) {
    const states = [], exports = {};
    let finish, calls = 0, invalidations = 0;
    runSource(source, { exports, require: id => {
      if (id === 'react') return { useState: () => [null, value => states.push(value)] };
      if (id === '@/lib/bridge/utils') return friendlyExports;
      if (id === '@tanstack/react-query') return {
        useQueryClient: () => ({ invalidateQueries: () => { invalidations++; } }),
        useMutation: options => ({ isPending: false, mutateAsync: async params => {
          try { return await options.mutationFn(params); } finally { options.onSettled(); }
        } }),
      };
      if (id === '@/lib/axios') return { api: { post: async (url, params, options) => {
        calls++;
        assert.equal(url, '/trade/route');
        assert.equal(params.minFinalOut, '99');
        await new Promise(resolve => { finish = resolve; });
        if (outcome === 'account success') return { data: { status: 'Success', hash: 'account-hash' } };
        if (outcome === 'account response lost') throw { message: 'Network Error', request: {} };
        if (outcome === 'account rejected') throw { message: 'Request rejected', request: {}, response: { status: 400 } };
        const emit = options.walletTxProgress;
        emit({ index: 0, total: 2, status: 'signing', functionName: 'approve', hash: 'unsigned-approval' });
        assert.equal(states.at(-1).transactions[0].submittedHash, undefined);
        if (outcome === 'rejected') {
          emit({ index: 0, total: 2, status: 'failed' });
          throw new Error('User rejected');
        }
        emit({ index: 0, total: 2, status: 'submitted', hash: 'approval-hash' });
        emit({ index: 1, total: 2, status: 'signing', functionName: 'executeRoute' });
        emit({ index: 1, total: 2, status: 'submitted', hash: 'trade-hash' });
        emit({ index: 1, total: 2, status: 'confirming', hash: 'trade-hash' });
        assert.equal(states.at(-1).transactions[1].functionName, 'executeRoute');
        if (outcome === 'confirmation unavailable') throw new Error('network unavailable');
        if (outcome === 'failure response') return { data: { status: 'Failure', hash: 'trade-hash' } };
        if (outcome === 'reverted') {
          emit({ index: 1, total: 2, status: 'failed', hash: 'trade-hash' });
          throw new Error('solidity require failed: TR: unregistered v2 pool');
        }
        if (outcome === 'wallet success') {
          emit({ index: 0, total: 2, status: 'completed', hash: 'approval-hash' });
          emit({ index: 1, total: 2, status: 'completed', hash: 'trade-hash' });
        }
        return { data: { status: outcome === 'pending' ? 'Pending' : 'Success', hash: 'approval-hash' } };
      } } };
      throw new Error(`Unexpected import ${id}`);
    } });
    const hook = exports.useRouteExecute();
    const promise = hook.mutateAsync({ minFinalOut: '99' });
    assert.equal(states.at(-1).status, 'pending', 'progress starts before the API responds');
    finish();
    if (['account response lost', 'account rejected', 'rejected', 'reverted', 'failure response', 'confirmation unavailable'].includes(outcome)) await assert.rejects(promise);
    else await promise;
    const result = states.at(-1);
    assert.equal(result.status, outcome.includes('success') ? 'success' : ['account response lost', 'pending', 'confirmation unavailable'].includes(outcome) ? 'unconfirmed' : 'error');
    if (outcome === 'wallet success') assert.equal(result.hash, 'trade-hash');
    if (outcome === 'rejected') assert.match(result.message, /cancelled/);
    if (outcome === 'reverted') {
      assert.match(result.message, /pool is not recognized/);
      assert.equal(result.transactions[1].submittedHash, 'trade-hash');
    }
    if (result.status === 'unconfirmed') assert.match(result.message, /Do not resubmit/);
    assert.equal(invalidations, 1);
    assert.equal(calls, 1);
    hook.closeProgress();
    assert.equal(states.at(-1), null, 'only closing clears the terminal result');
  }
});

test('STRATO progress dialog displays steps and blocks dismissal until execution finishes', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const components = {};
  let openChange, closed = 0;
  const wrapper = ({ children }) => React.createElement('div', null, children);
  runSource(fs.readFileSync(path.join(__dirname, '../src/components/router/RouteProgressDialog.tsx'), 'utf8'), {
    exports: components, require: id => {
      if (id === 'react/jsx-runtime') return require(id);
      if (id === 'lucide-react') return { Loader2: wrapper };
      if (id === '@/components/ui/button') return { Button: props => React.createElement('button', props) };
      if (id === '@/components/ui/dialog') return {
        ...Object.fromEntries(['DialogContent', 'DialogDescription', 'DialogFooter', 'DialogHeader', 'DialogTitle'].map(name => [name, wrapper])),
        Dialog: ({ children, onOpenChange }) => { openChange = onOpenChange; return React.createElement('div', null, children); },
      };
      throw new Error(`Unexpected import ${id}`);
    },
  });
  const progress = { status: 'pending', message: 'Confirm the transaction in your wallet.', transactions: [
    { index: 0, total: 2, functionName: 'approve', status: 'submitted', submittedHash: 'approval-hash' },
    { index: 1, total: 2, functionName: 'executeRoute', status: 'signing', hash: 'unsigned-trade' },
  ] };
  const render = () => renderToStaticMarkup(React.createElement(components.default, { progress, onClose: () => { closed++; } }));
  const html = render();
  for (const text of ['Trade in progress', 'Token approval', 'Step 2 of 2: Trade', 'Confirm in your wallet', 'approval-hash', 'disabled']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /unsigned-trade/);
  openChange(false);
  assert.equal(closed, 0);
  progress.status = 'error';
  progress.message = 'Transaction cancelled.';
  assert.match(render(), /Trade not completed/);
  openChange(false);
  assert.equal(closed, 1);
  progress.status = 'success';
  assert.match(render(), /Trade complete/);
  progress.status = 'unconfirmed';
  assert.match(render(), /Trade awaiting confirmation/);
});

test('confirmation renders exact decimal amounts, fees, route and a distinct fallback outcome', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { formatUnits } = require('ethers');
  const components = {};
  const wrapper = ({ children }) => React.createElement('div', null, children);
  runSource(fs.readFileSync(path.join(__dirname, '../src/components/router/RouteConfirmDialog.tsx'), 'utf8'), {
    exports: components, require: id => {
      if (id === 'react/jsx-runtime') return require(id);
      if (id === '@/components/ui/button') return { Button: wrapper };
      if (id === '@/components/ui/copy') return { default: () => null };
      if (id === '@/components/ui/dialog') return Object.fromEntries(['Dialog', 'DialogContent', 'DialogDescription', 'DialogFooter', 'DialogHeader', 'DialogTitle'].map(name => [name, wrapper]));
      if (id === '@/lib/constants') return { SWAP_FEE: '0.02', WAD: 10n ** 18n };
      if (id === '@/utils/numberUtils') return { formatUnits, truncateAddress: value => value };
      if (id === '@/lib/route') return routeHelpers;
      if (id === './RoutePreview') return { default: props => { assert.equal(props.showMinimum, false); return React.createElement('span', null, props.steps[0].label); } };
      throw new Error(`Unexpected import ${id}`);
    },
  });
  const confirmation = {
    quote: { ...structuredClone(composite), amountOut: '1234567', minFinalOut: '1200000',
      bridge: { ...composite.bridge, bridgedAmount: '1000000000000000000', targetStratoSymbol: 'USDST' },
      steps: [{ action: 5, label: 'Metal Forge', tokenIn: address('2'), tokenOut: address('3'), feeAmount: '10000000000000000', feeBps: 25, target: address('7') }] },
    inputSymbol: 'USDC', inputDecimals: 6, inputAmount: '2000000',
    outputToken: { _symbol: 'METAL', customDecimals: 6 }, tokens: [{ address: address('2'), _symbol: 'USDST', customDecimals: 18 }],
    recipient: address('5'), networkName: 'Ethereum',
  };
  const render = () => renderToStaticMarkup(React.createElement(components.default, { confirmation, pending: false, onClose: () => {}, onConfirm: () => {} }));
  const html = render();
  for (const text of ['2.0 USDC', '1.234567 METAL', '0.6172835 METAL', '1.2 METAL', '0.25%', 'Metal Forge',
    'Fallback: 1.0 USDST', 'minimum does not apply to this fallback', 'Network gas', address('5')]) assert.ok(html.includes(text), text);
  for (const destination of ['vault', 'savings']) {
    confirmation.outputToken.routeDestination = destination;
    assert.match(render(), new RegExp(`Confirm bridge &amp; ${destination} deposit`));
    assert.match(render(), /Minimum shares if deposited/);
    assert.match(render(), /APY does not apply to the fallback asset/);
  }
  delete confirmation.outputToken.routeDestination;
  confirmation.quote.bridge.rebaseFactor = '1000000000000000000';
  assert.match(render(), /approximately.*factor at settlement/);
  confirmation.quote.depositAction.action = 0;
  assert.match(render(), /received amount depends on the rebase factor at settlement/);
  assert.doesNotMatch(render(), /Minimum received/);
  delete confirmation.quote.bridge;
  delete confirmation.quote.depositAction;
  assert.match(render(), /0.02 USDST/);
  assert.doesNotMatch(render(), /Fallback:/);
});

test('fee balance failures stay unavailable until both requests succeed', async () => {
  const source = ts.createSourceFile('TokenContext.tsx', fs.readFileSync(path.join(__dirname, '../src/context/TokenContext.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let fetchBalance;
  const gates = {};
  function visit(node, file) {
    if (ts.isVariableDeclaration(node)) {
      const name = node.name.getText(file);
      if (name === 'fetchUsdstBalance' && node.initializer) fetchBalance = node.initializer.arguments[0].getText(file);
      if (['feeBalancesReady', 'feeError'].includes(name) && node.initializer && !node.initializer.getText(file).includes('useFeeBalancesReady')) {
        gates[name] = node.initializer.getText(file);
      }
    }
    ts.forEachChild(node, child => visit(child, file));
  }
  visit(source, source);
  visit(widgetSource, widgetSource);
  visit(feeHookSource, feeHookSource);
  for (const failedEndpoint of ['/tokens/balance', '/vouchers/balance']) {
    let fail = true, balances = ['0', '0'], error = null, loading = false;
    const exports = {};
    runSource(`exports.fetch = ${fetchBalance};`, {
      exports, usdstAddress: address('1'),
      api: { get: async url => {
        if (fail && url === failedEndpoint) throw new Error('Network Error');
        return { data: url === '/tokens/balance' ? [{ balance: '1000000000000000000' }] : { balance: '0' } };
      } },
      setUsdstBalance: value => { balances[0] = value; }, setVoucherBalance: value => { balances[1] = value; },
      setUsdstBalanceError: value => { error = value; }, setLoadingUsdstBalance: value => { loading = value; },
    });
    const gate = () => {
      const result = {};
      runSource(`const feeBalancesReady = ${gates.feeBalancesReady}; exports.ready = feeBalancesReady; exports.error = ${gates.feeError};`, {
        exports: result, userAddress: address('1'), feeBalanceOwner: address('1'), usdstBalanceError: error,
        guestMode: false, sourceMode: 'strato', availableFees: BigInt(balances[0]) + BigInt(balances[1]),
        routeFeeWei: 20000000000000000n, SWAP_FEE: '0.02', formatUnits: require('ethers').formatUnits,
      });
      return result;
    };
    await exports.fetch();
    assert.equal(loading, false);
    assert.equal(gate().ready, false);
    assert.match(gate().error, /Fee balances unavailable/);
    assert.doesNotMatch(gate().error, /you have 0/);
    fail = false;
    await exports.fetch();
    assert.equal(gate().ready, true);
    assert.equal(gate().error, '');
    fail = true;
    await exports.fetch();
    assert.equal(gate().ready, false, 'a failed background refresh also blocks fee-dependent actions');
    assert.match(gate().error, /Fee balances unavailable/);
    fail = false;
    await exports.fetch();
    const controller = new AbortController();
    controller.abort();
    fail = true;
    await exports.fetch(controller.signal);
    assert.equal(error, null, 'cancelled requests do not overwrite fee state');
  }
});

test('native redemption hides DepositRouter limits while standard deposits show loading and limits', () => {
  let help;
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.attributes.getText(widgetSource).includes('id="pay-amount-help"')) help = node.getText(widgetSource);
    ts.forEachChild(node, visit);
  }
  visit(widgetSource);
  const render = (nativeRedemption, depositConfig) => {
    const exports = {};
    runSource(`exports.element = (${help});`, {
      exports, require, nativeRedemption, depositConfig, sourceMode: 'external', externalRoute: { externalSymbol: 'USDC' },
      inputDecimals: 6, minDepositError: '', amountError: '', externalBalanceError: '', formatUnits: require('ethers').formatUnits,
    });
    return require('react-dom/server').renderToStaticMarkup(exports.element);
  };
  assert.match(render(false, {}), /Loading deposit limits/);
  assert.match(render(false, { data: { minAmount: '1000000' } }), /Minimum deposit: 1.0 USDC/);
  for (const config of [{}, { data: { minAmount: '1000000' } }, { isError: true }]) {
    assert.doesNotMatch(render(true, config), /Loading deposit limits|Minimum deposit|Retry/);
  }
});

test('external deposit limits gate initial loading, failures, disabled tokens and below-minimum amounts', () => {
  const declarations = {};
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ['depositConfigReady', 'minDepositError'].includes(node.name.getText(widgetSource))) declarations[node.name.getText(widgetSource)] = node.initializer.getText(widgetSource);
    ts.forEachChild(node, visit);
  }
  visit(widgetSource);
  const evaluate = (depositConfig, amountWei = '1000000', overrides = {}) => {
    const exports = {};
    runSource(`exports.ready = ${declarations.depositConfigReady}; exports.error = ${declarations.minDepositError};`, {
      exports, depositConfig, amountWei, sourceMode: 'external', nativeRedemption: false, network: { depositRouter: address('1') }, balanceChainId: 1,
      inputDecimals: 6, externalRoute: { externalSymbol: 'USDC' }, formatUnits: require('ethers').formatUnits, ...overrides,
    });
    return exports;
  };
  assert.equal(evaluate({}).ready, false);
  assert.match(evaluate({ isError: true }).error, /unavailable/);
  const allowed = { data: { minAmount: '1000000', isPermitted: true } };
  assert.equal(evaluate(allowed).error, '');
  assert.match(evaluate(allowed, '999999').error, /Minimum deposit is 1.0 USDC/);
  assert.match(evaluate({ data: { ...allowed.data, isPermitted: false } }).error, /not permitted/);
  assert.equal(evaluate(allowed, '0').error, '');
  assert.equal(evaluate({ isError: true }, '1', { sourceMode: 'strato' }).error, '');
  assert.match(evaluate(allowed, '1', { balanceChainId: undefined }).error, /unavailable/);
  assert.deepEqual(evaluate({ isError: true }, '1', { nativeRedemption: true, network: {}, externalRoute: { externalBridge: address('8') } }),
    { ready: true, error: '' }, 'native redemption bypasses DepositRouter limits');
});

test('deposit-limit query follows chain, router and token without retaining prior limits', async () => {
  const hooks = {};
  let query, args;
  runSource(fs.readFileSync(path.join(__dirname, '../src/hooks/trade/useTradeTokens.ts'), 'utf8'), {
    exports: hooks, require: id => {
      if (id === '@tanstack/react-query') return { useQuery: options => { query = options; return options; } };
      if (id === '@/lib/bridge/contractService') return { getTokenConfig: async input => { args = input; return { minAmount: '100', isPermitted: true }; } };
      return {};
    },
  });
  hooks.useRouteDepositConfig({ chainId: '1', depositRouter: address('1') }, { externalToken: address('2') }, true);
  const key = JSON.stringify(query.queryKey);
  assert.equal(query.enabled, true);
  await query.queryFn();
  assert.equal(args.chainId, 1);
  assert.equal(args.tokenAddress, address('2'));
  hooks.useRouteDepositConfig({ chainId: '8453', depositRouter: address('3') }, { externalToken: address('4') }, true);
  assert.notEqual(JSON.stringify(query.queryKey), key);
  assert.equal(query.placeholderData, undefined);
  hooks.useRouteDepositConfig({ chainId: '9007199254740992', depositRouter: address('1') }, { externalToken: address('2') }, true);
  assert.equal(query.enabled, false);
});

test('guest primary action opens wallet connection while authenticated trades require a valid quote', () => {
  let button;
  function visit(node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(widgetSource) === 'Button' && node.attributes.getText(widgetSource).includes('onClick={guestMode ? requestWalletConnection')) button = node;
    ts.forEachChild(node, visit);
  }
  visit(widgetSource);
  const expression = name => button.attributes.properties.find(prop => prop.name?.getText(widgetSource) === name).initializer.expression.getText(widgetSource);
  let connections = 0, reviews = 0;
  const evaluate = guestMode => {
    const exports = {};
    runSource(`exports.disabled = ${expression('disabled')}; exports.click = ${expression('onClick')};`, {
      exports, guestMode, pending: false, sourceMode: 'strato', quoteLoading: false, quote: null,
      selectionError: '', amountError: '', feeError: '', feeBalancesReady: false, externalBalanceError: '', amountWei: '0',
      requestWalletConnection: () => connections++, reviewTrade: () => reviews++,
    });
    return exports;
  };
  const guest = evaluate(true);
  assert.equal(guest.disabled, false);
  guest.click();
  assert.equal(connections, 1);
  assert.equal(reviews, 0);
  assert.equal(evaluate(false).disabled, true);
});

for (const [native, approval, labels, total] of [
  [true, false, ['Confirm deposit in your wallet'], 1],
  [false, false, ['Sign Permit2 authorization in your wallet', 'Confirm deposit in your wallet'], 2],
  [false, true, ['Approve USDC in your wallet', 'Sign Permit2 authorization in your wallet', 'Confirm deposit in your wallet'], 3],
]) {
  test(`deposit progress follows native=${native}, approval=${approval} wallet interactions`, async () => {
    const harness = depositHarness({ native, approval });
    await harness.handleTrade();
    assert.equal(harness.toasts[0].title, 'Deposit submitted');
    const walletStages = harness.stages.filter(stage => stage?.label.includes('in your wallet'));
    assert.deepEqual(walletStages.map(stage => stage.label), labels);
    assert.deepEqual(walletStages.map(stage => stage.step), Array.from({ length: total }, (_, index) => index + 1));
    assert.ok(walletStages.every(stage => stage.total === total));
    assert.equal(harness.stages.at(-1), null);
  });
}

test('flip clears the amount and swaps valid STRATO tokens, excluding output-only and external routes', () => {
  let flip;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(widgetSource) === 'flipTokens') flip = node.initializer.getText(widgetSource);
    ts.forEachChild(node, visit);
  }
  visit(widgetSource);
  const run = (sourceMode, routable) => {
    const exports = {}, changes = [];
    runSource(`exports.flip = ${flip};`, { exports, sourceMode, tokenIn: { address: 'in' }, tokenOut: { address: 'out' }, routeSources: routable ? [{ address: 'out' }] : [],
      setTokenInAddress: value => changes.push(['in', value]), setTokenOutAddress: value => changes.push(['out', value]),
      setAmount: value => changes.push(['amount', value]), setAmountError: value => changes.push(['error', value]) });
    exports.flip();
    return changes;
  };
  assert.deepEqual(run('strato', true), [['in', 'out'], ['out', 'in'], ['amount', ''], ['error', '']]);
  assert.deepEqual(run('external', true), []);
  assert.deepEqual(run('strato', false), []);
});

test('quote state permits background refresh but blocks missing quotes for changed inputs', () => {
  let loading;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(widgetSource) === 'quoteLoading') loading = node.initializer.getText(widgetSource);
    ts.forEachChild(node, visit);
  }
  visit(widgetSource);
  for (const [quote, amountWei, expected] of [[{}, '100', false], [undefined, '100', true], [undefined, '0', false]]) {
    const exports = {};
    runSource(`exports.loading = ${loading};`, { exports, quote, amountWei, quoteError: null });
    assert.equal(exports.loading, expected);
  }
});

test('quote summary distinguishes first load, changed inputs and background refresh while retaining the minimum', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const exports = {};
  runSource(fs.readFileSync(path.join(__dirname, '../src/components/router/RouteTradeSummary.tsx'), 'utf8'), { exports, require: id => {
    if (id === 'react/jsx-runtime') return require(id);
    if (id === 'lucide-react') return require(id);
    if (id === '@/lib/constants') return { SWAP_FEE: '0.02', WAD: 10n ** 18n };
    if (id === '@/utils/numberUtils') return { formatUnits: require('ethers').formatUnits, formatAmount: value => value };
    throw new Error(id);
  } });
  const render = (quote, fetching, error) => renderToStaticMarkup(React.createElement(exports.default, {
    quote, fetching, error, inputAmount: '2000000', inputDecimals: 6, inputSymbol: 'USDC', outputToken: { _symbol: 'GOLDST', customDecimals: 6 }, external: false,
  }));
  assert.match(render(undefined, false), /Enter an amount/);
  assert.match(render(undefined, true), /Getting quote/);
  const html = render({ amountOut: '1234567', minFinalOut: '1200000' }, true);
  assert.match(html, /Updating quote/);
  assert.match(html, /1.2 GOLDST/);
  assert.match(html, /0.6172835 GOLDST/);
  assert.match(html, /0.02 USDST/);
  assert.doesNotMatch(render(undefined, true), /1.2 GOLDST/);
  const blocked = render(undefined, false, 'No route is available for this amount.');
  assert.match(blocked, /text-destructive/);
  assert.match(blocked, /role="alert"/);
  assert.match(blocked, /No route is available/);
  assert.doesNotMatch(render(undefined, true), /text-destructive|role="alert"/);
});

test('native redemption approves its own bridge only when needed and records the pinned recipient', async () => {
  for (const approval of [true, false]) {
    for (const appAuthenticated of [true, false]) {
      const harness = depositHarness({ redemption: true, approval, appAuthenticated });
      await harness.handleTrade();
      assert.deepEqual(harness.writes, approval ? ['approve', 'requestRedemption'] : ['requestRedemption']);
      const redemption = harness.writeParams.at(-1);
      assert.equal(redemption.address, `0x${address('8')}`);
      assert.equal(redemption.args[0], `0x${address('1')}`);
      assert.equal(redemption.args[1], 100n);
      assert.equal(redemption.args[2], `0x${address(appAuthenticated ? '6' : '5')}`);
      if (approval) assert.deepEqual(Array.from(harness.writeParams[0].args), [`0x${address('8')}`, 100n]);
      assert.equal(harness.records()[1].type, 'bridge');
      assert.equal(harness.records()[1].routeType, 'native');
      assert.equal(harness.records()[1].DepositInfo.stratoTokenAmount, '100');
      assert.equal(harness.records()[1].DepositInfo.stratoRecipient, appAuthenticated ? address('6') : `0x${address('5')}`);
      assert.equal(harness.stages.find(stage => stage?.label === 'Confirm deposit in your wallet').total, approval ? 2 : 1);
    }
  }
});

test('native redemption timeouts retain pending deposits and reverts remove them', async () => {
  for (const outcome of ['timeout', 'rpc-error', 'reverted']) {
    const harness = depositHarness({ redemption: true, outcome });
    await harness.handleTrade();
    assert.deepEqual(harness.writes, ['requestRedemption']);
    assert.equal(harness.records().length, outcome === 'reverted' ? 1 : 2);
    assert.equal(harness.toasts[0].title, outcome === 'reverted' ? 'Transaction failed' : 'Deposit still pending');
    if (outcome !== 'reverted') assert.match(harness.toasts[0].description, /do not resubmit/);
    const approval = depositHarness({ redemption: true, approval: true, outcome });
    await approval.handleTrade();
    assert.deepEqual(approval.writes, ['approve']);
    assert.equal(approval.records().length, 1);
  }
});

test('native redemption stops after approval if the recipient changes or the quote expires', async () => {
  for (const options of [{ approvalExpires: true }, { changeIdentityAt: 'approval', mutateIdentity: user => { user.isAppAuthenticated = false; } }]) {
    const harness = depositHarness({ redemption: true, approval: true, ...options });
    await harness.handleTrade();
    assert.deepEqual(harness.writes, ['approve']);
    assert.equal(harness.records().length, 1);
    assert.match(harness.toasts[0].description, options.approvalExpires ? /approval succeeded and is reusable/ : /session changed/);
  }
  const harness = depositHarness({ redemption: true, appAuthenticated: false, code: '0x60806040' });
  await harness.handleTrade();
  assert.deepEqual(harness.writes, []);
});

test('native quotes bind the representation bridge, output and redemption amount', () => {
  const quote = structuredClone(composite);
  Object.assign(quote, { tokenOut: address('2'), amountOut: '100', minFinalOut: '100' });
  Object.assign(quote.bridge, { routeType: 'native', externalBridge: address('8') });
  quote.depositAction = { action: 0, actionToken: address('2'), minFinalOut: '100' };
  const expected = { ...binding, routeType: 'native', externalBridge: address('8'), tokenOut: address('2') };
  assert.doesNotThrow(() => assertAutoRouteQuote(quote, expected, 1000));
  for (const mutation of [q => { q.bridge.externalBridge = address('9'); }, q => { q.bridge.routeType = 'standard'; },
    q => { q.bridge.bridgedAmount = '99'; }, q => { q.steps = [{}]; }, q => { q.tokenOut = address('4'); }]) {
    const changed = structuredClone(quote);
    mutation(changed);
    assert.throws(() => assertAutoRouteQuote(changed, expected, 1000));
  }
});

test('native tokens appear without swap pools and allow a selected routed destination', () => {
  const expressions = {};
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ['routeAssets', 'externalRoutes', 'tokenOut'].includes(node.name.getText(widgetSource))) {
      expressions[node.name.getText(widgetSource)] = node.initializer.getText(widgetSource);
    }
    ts.forEachChild(node, visit);
  }
  visit(widgetSource);
  const native = { routeType: 'native', enabled: true, externalBridge: address('8'), stratoToken: `0x${address('a')}`, stratoTokenDecimals: 2 };
  const exports = {};
  runSource(`const routeAssets = ${expressions.routeAssets}; exports.assets = routeAssets;
    exports.external = ${expressions.externalRoutes}; exports.output = ${expressions.tokenOut};`, {
    exports, useMemo: fn => fn(), ...routeHelpers, routeAssetsQuery: { data: [] }, nativeRedemption: true, externalRoute: native,
    resolvingPool: false, selection: { tokenOut: { address: address('b') } },
    bridgeableTokens: [native, { ...native, depositsPaused: true }, { ...native, depositsDisabled: true }, { ...native, enabled: false }, { ...native, externalBridge: '' }],
  });
  assert.equal(exports.assets.length, 1);
  assert.equal(exports.assets[0].customDecimals, 2);
  assert.equal(exports.external.length, 1);
  assert.equal(exports.output.address, address('b'));
});

test('Fund and Trade providers keep catalog caches and history endpoints separate', async () => {
  const providers = {}, calls = [];
  runSource(fs.readFileSync(path.join(__dirname, '../src/context/BridgeContext.tsx'), 'utf8'), {
    exports: providers, AbortController, URLSearchParams, require: id => {
      if (id === 'react/jsx-runtime') return require(id);
      if (id === 'react') return {
        createContext: () => ({ Provider: () => null }), useState: value => [value, () => {}],
        useRef: value => ({ current: value }), useCallback: fn => fn,
      };
      if (id === '@/lib/bridge/constants') return bridgeConstants;
      if (id === '@/lib/axios') return { api: { get: async url => {
        calls.push(url);
        if (url.endsWith('/networkConfigs')) return { data: [{ externalChainId: 1, chainInfo: { enabled: true, chainName: 'Ethereum', depositRouter: url.startsWith('/trade') ? 'new-router' : 'legacy-router' } }] };
        return { data: [] };
      } } };
      return {};
    },
  });
  const fund = providers.BridgeProvider({ children: null }).props.value;
  const trade = providers.BridgeProvider({ children: null, scope: 'trade' }).props.value;
  await fund.loadNetworksAndTokens();
  await trade.loadNetworksAndTokens();
  await fund.loadNetworksAndTokens();
  await trade.loadNetworksAndTokens();
  assert.equal(calls.filter(url => url === '/bridge/bridgeableTokens/1').length, 1);
  assert.equal(calls.filter(url => url === '/trade/bridge/bridgeableTokens/1').length, 1);
  await fund.fetchDepositTransactions();
  await trade.fetchDepositTransactions();
  await fund.fetchWithdrawTransactions();
  await trade.fetchWithdrawTransactions();
  assert.deepEqual(calls.slice(-4), ['/bridge/transactions/deposit?', '/trade/bridge/transactions/deposit?', '/bridge/transactions/withdrawal?', '/trade/bridge/transactions/withdrawal?']);
  assert.equal(fund.pendingDepositsKey, 'pendingDeposits');
  assert.equal(trade.pendingDepositsKey, 'tradePendingDeposits');
});

test('Trade catalog uses only its own endpoints and query keys', async () => {
  const hooks = {}, queries = [], requests = [];
  runSource(fs.readFileSync(path.join(__dirname, '../src/hooks/trade/useTradeTokens.ts'), 'utf8'), {
    exports: hooks, require: id => {
      if (id === 'react') return { useMemo: fn => fn(), useState: value => [value, () => {}] };
      if (id === '@/lib/bridge/constants') return bridgeConstants;
      if (id === '@tanstack/react-query') return { useQuery: query => {
        queries.push(query);
        return { data: queries.length === 1 ? [{ chainId: '1', chainName: 'Ethereum' }] : [] };
      } };
      if (id === '@/lib/axios') return { api: { get: async url => { requests.push(url); return { data: [] }; } } };
      return {};
    },
  });
  hooks.useTradeBridgeCatalog();
  for (const query of queries) {
    assert.equal(query.queryKey[0], 'trade');
    await query.queryFn({});
  }
  assert.deepEqual(requests, ['/trade/bridge/networkConfigs', '/trade/bridge/bridgeableTokens/1']);
});

test('pending deposit history migrates old Trade submissions without leaking between pages', () => {
  const storage = new Map([['pendingDeposits', JSON.stringify([
    { externalChainId: 1, externalTxHash: 'fund' },
    { externalChainId: 1, externalTxHash: 'trade', depositRouter: 'router' },
    { externalChainId: 1, externalTxHash: 'native', routeType: 'native' },
  ])]]);
  const exports = {};
  const declaration = utilsSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'mergePendingDeposits');
  runSource(declaration.getText(utilsSource), { exports, ...bridgeConstants,
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  });
  const fund = exports.mergePendingDeposits([]).remaining;
  assert.deepEqual(Array.from(fund, p => p.externalTxHash), ['fund']);
  const trade = exports.mergePendingDeposits([{ externalTxHash: 'trade' }], 'tradePendingDeposits').remaining;
  assert.deepEqual(Array.from(trade, p => p.externalTxHash), ['native']);
  assert.equal(JSON.parse(storage.get('pendingDeposits'))[0].externalTxHash, 'fund');
  assert.equal(exports.mergePendingDeposits([]).remaining.length, 1);
});


test('native routed deposits submit the pinned output and minimum to the representation bridge', async () => {
  const harness = depositHarness({ redemption: true, routedRedemption: true, approval: true });
  await harness.handleTrade();
  assert.deepEqual(harness.writes, ['approve', 'requestRedemptionWithRoute']);
  const request = harness.writeParams.at(-1);
  assert.equal(request.address, `0x${address('8')}`);
  assert.deepEqual(Array.from(request.args), [`0x${address('1')}`, 100n, `0x${address('6')}`, `0x${composite.tokenOut}`, BigInt(composite.minFinalOut)]);
  assert.equal(harness.records()[1].type, 'route');
});

const earnUtils = {};
runSource(fs.readFileSync(path.join(__dirname, '../src/utils/earnUtils.ts'), 'utf8'), { exports: earnUtils });

test('asset APY excludes rewards and opportunities requiring an additional earn action', () => {
  const opportunities = [
    { source: 'lending', apy: '9' },
    { source: 'rewards', apy: '100', meta: 'vault' },
    { source: 'staking', apy: '12' },
    { source: 'swap', apy: '8', poolAddress: 'pool' },
    { source: 'base', apy: '4', poolAddress: 'pool' },
  ];
  assert.equal(earnUtils.buildAssetApyInfo(opportunities), null);
  assert.equal(earnUtils.buildAssetApyInfo([...opportunities, { source: 'base', apy: '3.5' }]).total, 3.5);
  assert.equal(earnUtils.buildAssetApyInfo([{ source: 'lending', apy: '5', meta: 'save_usdst' }]).total, 5);
  assert.equal(earnUtils.buildAssetApyInfo([
    { source: 'vault', apy: '2' }, { source: 'vault_weighted', apy: '4' }, ...opportunities,
  ]).total, 6);
  assert.equal(earnUtils.buildAssetApyInfo([{ source: 'base', apy: '-' }]), null);
});

test('receive asset shows holding yield only, keeping rewards in the hop-deduped route widget', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const exports = {};
  let tooltipInfo;
  runSource(fs.readFileSync(path.join(__dirname, '../src/components/router/RouteAssetYield.tsx'), 'utf8'), {
    exports,
    require: id => {
      if (id === '@/components/earn/EarnApyTooltip') return { default: ({ info, children }) => { tooltipInfo = info; return children; } };
      if (id === '@/context/EarnContext') return { useEarnContext: () => ({ tokenApysLoaded: true, tokenApys: [{ token: 'AB', apys: [
        { source: 'base', apy: '4' }, { source: 'rewards', apy: '150', poolAddress: 'pool' },
      ] }] }) };
      if (id === '@/lib/route') return { normalizeRouteAddress: value => value.toLowerCase().replace(/^0x/, '') };
      if (id === '@/utils/earnUtils') return earnUtils;
      return require(id);
    },
  });
  const html = renderToStaticMarkup(React.createElement(exports.default, { address: '0xab' }));
  assert.match(html, /Est\. APY · 4\.00%/);
  assert.doesNotMatch(html, /154.00|150/, 'pool rewards APY is excluded — it does not accrue from holding the asset');
  assert.equal(JSON.stringify(tooltipInfo.breakdown.map(item => item.label)), JSON.stringify(['Base APY']));
  assert.doesNotMatch(html, /Rewards available|View requirements|additional deposit or stake|href=/);
});

test('route action labels distinguish savings, vault deposits, swaps and plain bridging', () => {
  for (const [destination, external, bridgeOnly, expected] of [
    ['vault', false, false, 'vault deposit'], ['vault', true, false, 'bridge & vault deposit'],
    ['savings', false, false, 'savings deposit'], ['savings', true, false, 'bridge & savings deposit'],
    ['token', false, false, 'swap'], ['token', true, false, 'bridge & swap'],
    ['vault', true, true, 'deposit'],
  ]) assert.equal(routeHelpers.getRouteActionLabel(destination, external, bridgeOnly), expected);
});

test('receive categories follow route metadata, preserve linked selections and exclude unavailable products', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const exports = {};
  let pickerProps;
  runSource(fs.readFileSync(path.join(__dirname, '../src/components/router/RouteReceivePanel.tsx'), 'utf8'), {
    exports, require: id => {
      if (id === '@/lib/constants') return { ROUTE_DESTINATIONS: [
        { value: 'token', label: 'Tokens' }, { value: 'savings', label: 'Savings' }, { value: 'vault', label: 'Yield vaults' },
      ] };
      if (id === '@/utils/numberUtils') return { formatAmount: value => value, formatUnits: value => value };
      if (id === '@/context/EarnContext') return { useEarnContext: () => ({ tokenApysLoaded: true, tokenApys: [
        { token: 'vault1', apys: [{ apy: '4' }] }, { token: 'vault2', apys: [{ apy: '6.2' }] },
        { token: 'vault3', apys: [{ apy: '147286' }] },
      ] }) };
      if (id === '@/lib/route') return { normalizeRouteAddress: value => (value ?? '').toLowerCase().replace(/^0x/, '') };
      if (id === '@/utils/earnUtils') return { buildAssetApyInfo: apys => {
        const total = apys.reduce((sum, entry) => sum + Number(entry.apy), 0);
        return total > 0 ? { total } : null;
      } };
      if (id === './RouteAssetYield') return { default: () => null };
      if (id === './RouteTokenPicker') return { default: props => { pickerProps = props; return null; } };
      return require(id);
    },
  });
  const tokens = [
    { id: 'token', address: 'token', symbol: 'TOKEN' },
    { id: 'vault1', address: 'vault1', symbol: 'ONE', routeDestination: 'vault' },
    { id: 'vault2', address: 'vault2', symbol: 'TWO', routeDestination: 'vault' },
    { id: 'vault3', address: 'vault3', symbol: 'BAD', routeDestination: 'vault' },
  ];
  let selected;
  const props = { tokens, token: { address: 'vault2', _symbol: 'TWO', routeDestination: 'vault' },
    loading: false, pending: false, onSelect: id => { selected = id; } };
  const html = renderToStaticMarkup(React.createElement(exports.default, props));
  assert.match(html, /You receive TWO shares on STRATO/);
  assert.match(html, /Yield vaults · up to 6\.2%/, 'earn categories advertise their best plausible holding APY');
  assert.doesNotMatch(html, /Tokens ·|Savings ·|147286/, 'categories without yield data stay unlabeled and bad benchmark data is excluded');
  assert.equal(pickerProps.value, 'vault2');
  assert.deepEqual(pickerProps.tokens.map(t => t.id), ['vault1', 'vault2', 'vault3']);
  const tree = exports.default(props);
  const categoryButtons = tree.props.children[0].props.children;
  assert.equal(categoryButtons[1].props.disabled, true, 'no savings product is fabricated');
  assert.equal(categoryButtons[2].props['aria-pressed'], true);
  categoryButtons[0].props.onClick();
  assert.equal(selected, 'token');
});
