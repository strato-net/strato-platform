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
    if (id === 'react') return { useState: () => [false, () => {}] };
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
