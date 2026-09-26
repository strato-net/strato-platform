const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const WAD = 10n ** 18n;
const address = digit => digit.repeat(40);
function load(file, imports) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { fileName: file, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, require: imports });
  return exports;
}
const utils = load('lib/bridge/utils.ts', id => id === '@/lib/constants' ? { WAD } : { SUPPORTED_CHAINS: {} });
const standard = {
  id: 'standard', routeType: 'standard', enabled: true, withdrawalsEnabled: true,
  stratoToken: address('1'), stratoTokenSymbol: 'USDC', stratoTokenName: 'USD Coin', stratoTokenDecimals: 18,
  externalChainId: '1', externalDecimals: '6', externalToken: address('2'), externalSymbol: 'USDC', maxPerWithdrawal: '0',
};
const native = { ...standard, id: 'native', routeType: 'native', externalBridge: address('3'),
  externalDecimals: '18', stratoTokenSymbol: 'GOLDST', externalSymbol: 'wGOLDST', stratoTokenDecimals: 2, instantWithdrawalThreshold: '500' };

test('EAB preview matches external-unit rounding and rounds rebase escrow up', () => {
  const plain = utils.getWithdrawalPreview(standard, WAD + 1n);
  assert.equal(plain.externalAmount, '1000000');
  assert.equal(plain.escrowAmount, WAD.toString());
  const rebased = utils.getWithdrawalPreview({ ...standard, rebaseRequired: true, rebaseFactor: (WAD * 3n / 2n).toString() }, WAD + 1n);
  assert.equal(rebased.externalAmount, '1500000');
  assert.equal(rebased.escrowAmount, WAD.toString());
  const rounded = utils.getWithdrawalPreview({ ...standard, rebaseRequired: true, rebaseFactor: (WAD * 3n).toString() }, 333333333334n);
  assert.equal(rounded.externalAmount, '1');
  assert.equal(rounded.escrowAmount, '333333333334');
});

test('EAB rejects missing conversion factors, invalid decimals and sub-unit amounts', () => {
  assert.throws(() => utils.getWithdrawalPreview({ ...standard, rebaseRequired: true }, WAD), /conversion rate/);
  assert.throws(() => utils.getWithdrawalPreview(standard, 1n), /minimum unit/);
  for (const externalDecimals of [null, '', 'wat', '19', '-1']) {
    assert.throws(() => utils.getWithdrawalPreview({ ...standard, externalDecimals }, WAD), /decimals/);
  }
});

test('EAB limits and review thresholds use external units', () => {
  const route = { ...standard, maxPerWithdrawal: '2000000', manualReviewThreshold: '1000000' };
  assert.equal(utils.getWithdrawalPreview(route, WAD).manualReview, false);
  assert.equal(utils.getWithdrawalPreview(route, 2n * WAD).manualReview, true);
  assert.throws(() => utils.getWithdrawalPreview(route, 3n * WAD), /per-withdrawal limit/);
});

test('native withdrawals preserve raw units and enforce native review and aggregate capacity', () => {
  const preview = utils.getWithdrawalPreview(native, 100n);
  assert.equal(preview.externalAmount, '100');
  assert.equal(preview.escrowAmount, '100');
  assert.equal(utils.getWithdrawalPreview(native, 500n).manualReview, false);
  assert.equal(utils.getWithdrawalPreview(native, 501n).manualReview, true);
  assert.equal(utils.getWithdrawalPreview({ ...native, instantWithdrawalThreshold: '0' }, 1n).manualReview, true);
  assert.throws(() => utils.getWithdrawalPreview({ ...native, maxPerWithdrawal: '10' }, 11n), /per-withdrawal limit/);
  assert.throws(() => utils.getWithdrawalPreview({ ...native, maxOutstandingWithdrawal: '1000', remainingOutstandingWithdrawal: '10' }, 11n), /remaining bridge capacity/);
});

test('withdrawal selection excludes disabled and paused routes', () => {
  for (const route of [
    { ...standard, withdrawalsEnabled: false }, { ...standard, enabled: false },
    { ...native, withdrawalsPaused: true }, { ...native, withdrawalsDisabled: true }, { ...native, externalBridge: '' },
  ]) assert.equal(utils.isWithdrawalRouteAvailable(route), false);
  assert.equal(utils.isWithdrawalRouteAvailable(standard), true);
  assert.equal(utils.isWithdrawalRouteAvailable(native), true);
});

for (const routeType of ['standard', 'native']) {
  test(`${routeType} withdrawal uses its endpoint and distinguishes request confirmation from delivery`, async () => {
    for (const outcome of ['Success', 'Pending', 'Failure', 'connection lost']) {
      const states = [];
      let posted, invalidations = 0;
      const hooks = load('hooks/trade/useRouteExecute.ts', id => {
        if (id === 'react') return { useState: () => [null, value => states.push(value)] };
        if (id === '@/lib/bridge/utils') return utils;
        if (id === '@tanstack/react-query') return {
          useQueryClient: () => ({ invalidateQueries: () => invalidations++ }),
          useMutation: options => ({ mutateAsync: async params => {
            try { return await options.mutationFn(params); } finally { options.onSettled(); }
          } }),
        };
        if (id === '@/lib/axios') return { api: { post: async (url, params) => {
          posted = { url, params };
          if (outcome === 'connection lost') throw { message: 'Network Error', request: {} };
          return { data: { status: outcome, hash: 'request-hash' } };
        } } };
        throw new Error(`Unexpected import ${id}`);
      });
      const params = { routeType, stratoTokenAmount: '100', externalRecipient: `0x${address('4')}` };
      const promise = hooks.useWithdrawalExecute().mutateAsync(params);
      if (['Failure', 'connection lost'].includes(outcome)) await assert.rejects(promise);
      else await promise;
      assert.equal(posted.url, `/trade/bridge/${routeType === 'native' ? 'requestNativeWithdrawal' : 'requestWithdrawal'}`);
      assert.equal(posted.params, params);
      assert.equal(invalidations, 1);
      assert.equal(states.at(-1).status, outcome === 'Success' ? 'success' : outcome === 'Failure' ? 'error' : 'unconfirmed');
      assert.match(states.at(-1).message, outcome === 'Success' ? /request is confirmed on STRATO.*Track the external transfer/ : outcome === 'Failure' ? /failed|revert/i : /Do not resubmit/);
    }
  });
}

function widgetHarness(route, isAppAuthenticated = true) {
  const { parseUnits, formatUnits } = require('viem');
  const state = [], refs = [], submitted = [], toasts = [];
  let cursor = 0, refCursor = 0, tree;
  const user = { isLoggedIn: true, isAppAuthenticated, userAddress: address('4'), externalEvmWalletAddress: `0x${address('5')}` };
  const fees = { usdstBalance: WAD.toString(), voucherBalance: '0', fetchUsdstBalance: async () => {} };
  const parse = (value, decimals = 18) => { try { return parseUnits(value, decimals); } catch { return 0n; } };
  const numberUtils = { safeParseUnits: parse, formatUnits: (value, decimals = 18) => formatUnits(BigInt(value), decimals), formatAmount: value => value, formatBalance: value => value, truncateAddress: value => value };
  const transfer = load('utils/transferValidation.ts', id => {
    if (id === '@/lib/constants') return { DECIMAL: 18 };
    if (id === '@/utils/numberUtils') return numberUtils;
    return require(id);
  });
  const wrapper = ({ children }) => children;
  const components = load('components/router/WithdrawalWidget.tsx', id => {
    if (id === 'react') return {
      useState: initial => { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = value; }]; },
      useRef: initial => refs[refCursor++] ?? (refs[refCursor - 1] = { current: initial }),
    };
    if (id === 'react/jsx-runtime') return require(id);
    if (id === 'lucide-react') return { Loader2: wrapper };
    if (id === '@/context/UserContext') return { useUser: () => user };
    if (id === '@/context/TokenContext') return { useTokenContext: () => fees };
    if (id === '@/context/UserTokensContext') return { useUserTokens: () => ({ activeTokens: [], fetchTokens: async () => {} }) };
    if (id === '@/context/BridgeContext') return { useBridgeContext: () => ({ triggerWithdrawalRefresh: () => {} }) };
    if (id === '@/hooks/use-toast') return { useToast: () => ({ toast: value => toasts.push(value) }) };
    if (id === '@/hooks/trade/useRouteExecute') return { useWithdrawalExecute: () => ({ isPending: false, progress: null, closeProgress: () => {}, mutateAsync: async params => { submitted.push(params); } }) };
    if (id === '@tanstack/react-query') return { useQuery: () => ({ data: (10n * WAD).toString(), refetch: async () => {} }) };
    if (id === '@/lib/constants') return { WAD, BRIDGE_OUT_FEE: '0.02', usdstAddress: address('9') };
    if (id === '@/lib/bridge/constants') return { BRIDGE_MODE_LABELS: { bridge: { title: 'Bridge Out Your Tokens', description: '', amountLabel: 'Amount' } } };
    if (id === '@/lib/route') return { normalizeRouteAddress: value => value.toLowerCase().replace(/^0x/, '') };
    if (id === '@/lib/bridge/utils') return utils;
    if (id === '@/utils/numberUtils') return numberUtils;
    if (id === '@/utils/transferValidation') return transfer;
    if (id === '@/components/ui/button') return { Button: wrapper };
    if (id === '@/components/ui/input') return { Input: wrapper };
    if (id === '@/components/ui/label') return { Label: wrapper };
    if (id.startsWith('@/components/') || id.startsWith('./')) return { default: wrapper };
    if (id === '@/lib/axios') return {};
    throw new Error(`Unexpected import ${id}`);
  });
  const props = { active: true, feeBalancesReady: true, onPendingChange: () => {}, catalog: {
    availableNetworks: [{ chainId: '1', chainName: 'Ethereum Mainnet' }], selectedNetwork: 'Ethereum Mainnet', bridgeableTokens: [route], loading: false,
  } };
  const render = () => { cursor = refCursor = 0; tree = components.default(props); };
  function find(predicate, value = tree) {
    if (Array.isArray(value)) return value.map(item => find(predicate, item ?? null)).find(Boolean);
    if (!value || typeof value !== 'object') return undefined;
    return predicate(value.props ?? {}) ? value : find(predicate, value.props?.children ?? null);
  }
  const change = (id, value) => { find(p => p.id === id || p['aria-label'] === id).props.onChange({ target: { value } }); render(); };
  const click = text => { const element = find(p => p.children === text && p.onClick); assert.ok(element, text); assert.ok(!element.props.disabled, `${text} enabled`); element.props.onClick(); render(); };
  const confirmModal = () => { const modal = find(p => p.onOk); assert.ok(modal, 'confirmation modal'); assert.ok(modal.props.open, 'confirmation modal open'); modal.props.onOk(); render(); };
  render();
  return { render, change, click, confirmModal, find, submitted, toasts, fees, user, props };
}

test('withdrawal summary and confirmation render exact preview amounts and the pinned recipient', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const numbers = load('utils/numberUtils.ts', id => id === 'json-bigint' ? { default: require(id) } : require(id));
  const imports = id => {
    if (id === '@/utils/numberUtils') return numbers;
    if (id === '@/lib/constants') return { WAD, DECIMAL: 18, BRIDGE_OUT_FEE: '0.02' };
    if (id === 'antd') return { Modal: ({ children }) => React.createElement('div', null, children) };
    return require(id);
  };
  const Summary = load('components/bridge/TransactionSummary.tsx', imports).default;
  const Confirmation = load('components/bridge/BridgeConfirmationModal.tsx', imports).default;
  for (const [route, amount, received, escrowed] of [
    [native, '1', '0.0000000000000001', '1.0'],
    [standard, '1.0000009', '1.0', '1.0'],
    [{ ...standard, rebaseRequired: true, rebaseFactor: (3n * WAD).toString(), manualReviewThreshold: '1' }, '0.0000006666667', '0.000002', '0.000000666666666667'],
  ]) {
    const h = widgetHarness(route);
    h.change('withdrawal-amount', amount);
    const summaryProps = h.find(p => p.balanceImpact).props;
    const summary = renderToStaticMarkup(React.createElement(Summary, summaryProps));
    assert.ok(summary.includes(`${received} ${route.externalSymbol}`), summary);
    h.click('Bridge Out');
    const confirmationProps = h.find(p => p.onOk).props;
    const confirm = renderToStaticMarkup(React.createElement(Confirmation, confirmationProps));
    assert.ok(confirm.includes(`${received} ${route.externalSymbol}`), confirm);
    assert.ok(confirm.includes(`${escrowed} ${route.stratoTokenSymbol}`), confirm);
    assert.ok(confirm.includes(h.user.externalEvmWalletAddress));
    assert.equal(confirm.includes('requires manual approval'), !!confirmationProps.preview.manualReview);
    h.user.externalEvmWalletAddress = `0x${address('6')}`;
    h.change('withdrawal-amount', '2');
    assert.equal(renderToStaticMarkup(React.createElement(Confirmation, h.find(p => p.onOk).props)), confirm,
      'review must keep the original amounts and recipient until reconfirmed');
  }
  const empty = widgetHarness(native);
  const summary = renderToStaticMarkup(React.createElement(Summary, empty.find(p => p.balanceImpact).props));
  assert.ok(summary.includes('— wGOLDST'));
});

for (const route of [standard, native]) {
  for (const isAppAuthenticated of [true, false]) {
    test(`${route.routeType} review submits the same asset and recipient for ${isAppAuthenticated ? 'STRATO' : 'wallet-only'} login`, async () => {
      const h = widgetHarness(route, isAppAuthenticated);
      h.change('withdrawal-amount', '1');
      h.click('Bridge Out');
      h.confirmModal();
      await Promise.resolve();
      assert.equal(h.submitted.length, 1);
      const params = h.submitted[0];
      assert.equal(params.stratoToken, route.stratoToken);
      assert.equal(params.stratoTokenAmount, route.routeType === 'native' ? '100' : WAD.toString());
      assert.equal(params.externalRecipient, h.user.externalEvmWalletAddress);
      assert.equal(params.externalToken, route.routeType === 'native' ? undefined : route.externalToken);
    });
  }
}

for (const change of ['account', 'recipient', 'session', 'fee balance', 'fee balance unavailable']) {
  test(`a late ${change} change requires withdrawal review again`, () => {
    const h = widgetHarness(standard);
    h.change('withdrawal-amount', '1');
    h.click('Bridge Out');
    if (change === 'account') h.user.userAddress = address('6');
    if (change === 'recipient') h.user.externalEvmWalletAddress = `0x${address('6')}`;
    if (change === 'session') h.user.isAppAuthenticated = false;
    if (change === 'fee balance') h.fees.usdstBalance = '0';
    if (change === 'fee balance unavailable') h.fees.usdstBalanceError = 'Fee balances unavailable. Retrying…';
    h.render();
    h.confirmModal();
    assert.equal(h.submitted.length, 0);
    assert.equal(h.toasts[0].title, 'Review withdrawal again');
  });
}
