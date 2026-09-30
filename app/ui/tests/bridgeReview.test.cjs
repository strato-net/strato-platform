const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const axiosExports = {};
const responseInterceptors = [], globalToasts = [];
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/axios.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, {
  exports: axiosExports,
  console: { warn() {} },
  require: id => id === 'axios' ? { default: { create: () => ({ interceptors: { request: { use() {} }, response: { use: (...args) => responseInterceptors.push(args) } } }) } } : id === '@/hooks/use-toast' ? { toast: value => globalToasts.push(value) } : {},
});

function harness({ kind = 'withdrawal_refund', action = 'refund', response, failure, status = 409, unavailable = false, approved = true, governanceStatus = "available", progress, approvalStatus, refundStatus = 'ready', refundEvidenceHash } = {}) {
  const state = []; let cursor = 0;
  const votes = [], requests = [];
  const item = { id: 'eab:withdrawal:2', reference: '2', source: 'eab', kind, chainId: '11155111', account: 'abc', token: 'def', amount: '100', reason: 'Review required', actions: kind === 'withdrawal_review' ? [] : [action], safeProposalHash: kind === 'withdrawal_review' ? 'a'.repeat(64) : undefined };
  if (action === 'confirm_refund') { item.source = 'native'; item.recoveryStatus = 'refund_pending'; item.refundEvidenceHash = refundEvidenceHash; }
  item.governanceStatus = governanceStatus;
  item.approvalStatus = approvalStatus;
  item.refundStatus = refundStatus;
  item.governance = { [action]: progress ?? { votesCast: 0, votesRequired: 2, hasVoted: false } };
  if (!approved) item.actions = item.actions.filter(action => action !== 'settle');
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  const source = fs.readFileSync(path.join(__dirname, '../src/components/admin/BridgeReviewQueue.tsx'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require: id => {
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (id === 'react') return { useState: initial => { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; } };
      if (id === '@tanstack/react-query') return { useQuery: () => ({ data: unavailable ? undefined : [item], isError: unavailable, refetch: async () => {} }) };
      if (id === '@/context/UserContext') return { useUser: () => ({ userAddress: 'admin', castVoteOnIssue: async (...args) => votes.push(args) }) };
      if (id === '@/lib/axios') return { extractApiErrorMessage: axiosExports.extractApiErrorMessage, api: { post: async (...args) => { requests.push(args); if (failure) throw { response: { status, data: { error: failure } } }; return { data: response }; } } };
      if (id === '@/lib/bridge/utils') return { getChainName: () => 'Sepolia' };
      if (id === '@/utils/numberUtils') return { truncateAddress: value => value, formatUnits: require('ethers').formatUnits };
      return new Proxy({}, { get: (_, name) => String(name) });
    },
  });
  const render = () => { cursor = 0; return exports.default(); };
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  const text = tree => !tree || typeof tree !== 'object' ? String(tree ?? '') : Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children);
  const select = () => nodes(render()).find(node => node.props?.children === (action === 'confirm_refund' ? 'Confirm refund / vote' : action === 'settle' ? 'Settle approved deposit' : action === 'reject' ? 'Reject / vote' : action === 'approve' ? kind === 'deposit_recovery' ? 'Complete delivery / vote' : 'Approve deposit / vote' : kind === 'withdrawal_refund' ? 'Refund / vote' : 'Return funds / vote')).props.onClick();
  const confirm = () => nodes(render()).find(node => node.type === 'Button' && text(node).includes(action === 'settle' ? 'Confirm settlement' : 'Confirm vote')).props.onClick();
  return { select, confirm, render, text, nodes, votes, requests };
}

test('admin refund UI submits a vote only after successful evidence preparation', async () => {
  const h = harness({ response: { target: 'bridge', func: 'refundWithdrawal', args: ['2'] } });
  h.select();
  assert.equal(h.requests.length, 0, 'opening confirmation must not attest or vote');
  await h.confirm();
  assert.equal(h.requests[0][0], '/bridge/admin/reviews/prepare');
  assert.deepEqual(h.votes, [['bridge', 'refundWithdrawal', ['2']]]);
});

test('failed refund evidence stays in the dialog and never casts a vote', async () => {
  const h = harness({ failure: 'External payment already occurred' });
  h.select(); await h.confirm();
  assert.equal(h.votes.length, 0);
  assert.match(h.text(h.render()), /External payment already occurred/);
});

test('governance API errors render an alert without crashing or closing confirmation', async () => {
  for (const { status, failure, expected } of [
    { status: 500, failure: { message: 'Internal service failure', status: 500, type: 'Error' }, expected: 'Something went wrong. Please try again later.' },
    { status: 409, failure: { message: 'Verifier threshold not reached', status: 409 }, expected: 'Verifier threshold not reached' },
    { status: 409, failure: 'Matching governance approval required', expected: 'Matching governance approval required' },
    { status: 400, failure: { message: { unexpected: true } }, expected: 'An unexpected error occurred.' },
  ]) {
    const h = harness({ kind: 'deposit_review', action: 'approve', status, failure });
    h.select(); await h.confirm();
    const tree = h.render();
    const alert = h.nodes(tree).find(node => node.props?.role === 'alert');
    assert.ok(alert);
    assert.equal(renderToStaticMarkup(React.createElement('p', alert.props)), `<p role="alert" class="text-sm text-destructive">${expected}</p>`);
    assert.equal(h.nodes(tree).find(node => node.type === 'Dialog').props.open, true);
    assert.equal(h.nodes(tree).find(node => node.type === 'Button' && h.text(node).includes('Confirm vote')).props.disabled, false);
    assert.equal(h.votes.length, 0);
    assert.equal(h.requests.length, 1);
  }
});

test('deposit rejection explains the lack of external refund', async () => {
  const rejection = harness({ kind: 'deposit_review', action: 'reject' });
  rejection.select();
  assert.match(rejection.text(rejection.render()), /does not refund external funds/);
});

test('unavailable queue is never presented as an empty healthy queue', () => {
  const h = harness({ unavailable: true });
  assert.match(h.text(h.render()), /review queue is unavailable/);
  assert.doesNotMatch(h.text(h.render()), /No transactions currently require review/);
});

test('STRATO shows withdrawals pending review with approval handled in Safe', () => {
  const h = harness({ kind: 'withdrawal_review' });
  const text = h.text(h.render());
  assert.match(text, /Withdrawal pending review/);
  assert.match(text, /Approval handled in Safe/);
  assert.doesNotMatch(text, /Reject \/ vote|Refund \/ vote/);
  assert.equal(h.requests.length, 0);
  assert.equal(h.votes.length, 0);
});

test('deposit review never offers manual settlement, including stale API actions', () => {
  for (const approved of [false, true]) {
    const h = harness({ kind: 'deposit_review', action: 'settle', approved });
    assert.doesNotMatch(h.text(h.render()), /Settle approved deposit|Confirm settlement/);
    assert.equal(h.requests.length, 0);
  }
});

test('refund votes stay disabled until indexed attestations are ready', () => {
  for (const refundStatus of ['pending', 'unavailable']) {
    const h = harness({ refundStatus });
    const tree = h.render();
    assert.equal(h.nodes(tree).find(node => node.type === 'Button' && node.props.children === 'Refund / vote').props.disabled, true);
    assert.match(h.text(tree), refundStatus === 'pending' ? /Awaiting verifier attestations/ : /attestation status is unavailable/);
    assert.equal(h.requests.length, 0);
  }
});

test('review actions reflect your vote and quorum without claiming approval', () => {
  const h = harness({ progress: { votesCast: 1, votesRequired: 2, hasVoted: true } });
  const tree = h.render();
  assert.match(h.text(tree), /Refund\s*:.*1.*of.*2.*votes.*You voted/);
  assert.equal(h.nodes(tree).find(node => node.type === 'Button' && h.text(node) === 'You voted').props.disabled, true);
  const quorum = harness({ progress: { votesCast: 2, votesRequired: 2, hasVoted: true } });
  const ready = quorum.render();
  assert.match(quorum.text(ready), /Quorum reached; execution pending/);
  assert.equal(quorum.nodes(ready).find(node => node.type === 'Button' && h.text(node) === 'Execute refund').props.disabled, false);
  assert.doesNotMatch(quorum.text(ready), /Approved · awaiting settlement/);
});

test('verified approval suppresses another approval vote; unavailable status blocks voting', () => {
  const h = harness({ kind: 'deposit_review', action: 'approve', approvalStatus: 'approved' });
  assert.match(h.text(h.render()), /Approved · awaiting settlement/);
  assert.equal(h.nodes(h.render()).some(node => node.type === 'Button' && h.text(node) === 'Approve deposit / vote'), false);
  const unavailable = harness({ governanceStatus: 'unavailable' });
  assert.match(unavailable.text(unavailable.render()), /Voting status is unavailable/);
  assert.equal(unavailable.nodes(unavailable.render()).find(node => node.type === 'Button' && h.text(node) === 'Refund / vote').props.disabled, true);
});

test('submitted vote stays distinct while Cirrus still returns the old vote count', async () => {
  const progress = { votesCast: 0, votesRequired: 2, hasVoted: false };
  const h = harness({ progress, response: { target: 'bridge', func: 'refundWithdrawal', args: ['2'] } });
  h.select(); await h.confirm();
  const tree = h.render();
  assert.match(h.text(tree), /Waiting for indexed status/);
  assert.equal(h.nodes(tree).find(node => node.type === 'Button' && h.text(node) === 'Vote submitted').props.disabled, true);
  assert.equal(h.votes.length, 1);
  progress.votesCast = 1; progress.hasVoted = true;
  assert.equal(h.nodes(h.render()).find(node => node.type === 'Button' && h.text(node) === 'You voted').props.disabled, true);
  assert.doesNotMatch(h.text(h.render()), /Waiting for indexed status/);
});

function processingHarness(result, component = 'BridgePolicies') {
  const state = []; let cursor = 0; let query;
  const exports = {}, requests = [];
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, `../src/components/admin/${component}.tsx`), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: id => {
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (id === 'react') return { useState: initial => { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = value; }]; } };
    if (id === '@tanstack/react-query') return { useQuery: options => { query = options; return { ...result, refetch() {} }; } };
    if (id === '@/lib/axios') return { api: { get: async (...args) => { requests.push(args); return { data: result.data }; } } };
    if (id === '@/lib/bridge/utils') return { getChainName: () => 'Sepolia' };
    if (id === '@/utils/numberUtils') return { truncateAddress: value => value, formatUnits: require('ethers').formatUnits };
    return new Proxy({}, { get: (_, name) => String(name) });
  } });
  const render = () => { cursor = 0; return exports.default(); };
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  const text = tree => !tree || typeof tree !== 'object' ? String(tree ?? '') : Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children);
  return { render, nodes, text, requests, query: () => query };
}

test('admin polling errors stay inline instead of producing repeated global toasts', async () => {
  for (const url of ['/bridge/admin/reviews', '/bridge/admin/policies']) {
    const error = { config: { url }, response: { status: 503, data: { error: 'unavailable' } } };
    await assert.rejects(responseInterceptors[0][1](error), value => value === error);
  }
  assert.equal(globalToasts.length, 0);
});

test('Cirrus policy panel loads on expansion, formats token units, and filters token/network rows', async () => {
  const h = processingHarness({ data: { fetchedAt: 1, unconfigured: [], items: [
    { id: 'eab:route:1', source: 'eab', kind: 'Route', token: 'abc', symbol: 'USDC', chainId: '11155111', externalToken: 'def', externalSymbol: 'USDC', fields: [
      { label: 'Maximum per withdrawal', value: '2000000', kind: 'amount', decimals: 6, unit: 'USDC' },
      { label: 'Unknown token limit', value: '2000000', kind: 'amount' },
      { label: 'Unavailable limit', value: null },
      { label: 'Large precision', value: '9', kind: 'amount', decimals: 255 },
    ] },
    { id: 'native:route:2', source: 'native', kind: 'Route', token: 'ghi', symbol: 'ETH', chainId: '1', fields: [] },
  ] } }, 'BridgePolicies');
  let tree = h.render();
  assert.equal(h.query().enabled, false);
  assert.equal(h.query().refetchInterval, false);
  h.nodes(tree).find(node => node.type === 'Collapsible').props.onOpenChange(true);
  tree = h.render();
  assert.equal(h.query().enabled, true);
  assert.equal(h.query().refetchInterval, 30_000);
  await h.query().queryFn();
  assert.equal(h.requests[0][0], '/bridge/admin/policies');
  assert.match(h.text(tree), /2.0 USDC/);
  assert.match(h.text(tree), /2000000 raw units/);
  assert.match(h.text(tree), /9 raw units/);
  assert.match(h.text(tree), /Unavailable/);
  assert.match(h.text(tree), /External-vault limits, liquidity, and verifier-local policies are not included/);
  h.nodes(tree).find(node => node.type === 'Input').props.onChange({ target: { value: 'USDC' } });
  tree = h.render();
  assert.equal(h.nodes(tree).filter(node => node.type === 'details').length, 1);
  assert.doesNotMatch(h.text(tree), /ETH/);
});

test('failed policy reads retain an explicit unavailable state and never claim no policies exist', () => {
  for (const data of [undefined, { items: [], unconfigured: [], fetchedAt: 1 }]) {
    const h = processingHarness({ isError: true, data }, 'BridgePolicies');
    assert.match(h.text(h.render()), /Indexed bridge policies are unavailable/);
    assert.doesNotMatch(h.text(h.render()), /No token policies or routes are indexed/);
    if (data) assert.match(h.text(h.render()), /displayed values may be stale/);
  }
});


test('deposit recovery presents delivery and return as distinct governance decisions', async () => {
  for (const action of ['approve', 'refund']) {
    const func = action === 'approve' ? 'authorizeDepositDelivery' : 'requestDepositRefund';
    const h = harness({ kind: 'deposit_recovery', action, response: { target: 'bridge', func, args: ['1', 'router', '7'] } });
    assert.match(h.text(h.render()), action === 'approve' ? /Complete delivery/ : /Return funds/);
    h.select();
    assert.match(h.text(h.render()), action === 'approve' ? /verified delivery/ : /permanently disables STRATO delivery/);
    await h.confirm();
    assert.equal(h.votes[0][1], func);
  }
});


test('native refund confirmation shows proof, casts its exact vote and rejects changed proof', async () => {
  const hash = '0x' + 'a'.repeat(64);
  const response = { target: 'bridge', func: 'finalizeDepositRefund', args: ['2', hash] };
  const h = harness({ kind: 'deposit_recovery', action: 'confirm_refund', refundEvidenceHash: hash, response });
  h.select();
  assert.match(h.text(h.render()), /Independently verify this transaction/);
  assert.match(h.text(h.render()), new RegExp(hash));
  assert.doesNotMatch(h.text(h.render()), /Reopen this deposit/);
  await h.confirm();
  assert.deepEqual(h.votes, [['bridge', response.func, response.args]]);
  const changed = harness({ kind: 'deposit_recovery', action: 'confirm_refund', refundEvidenceHash: hash,
    response: { ...response, args: ['2', '0x' + 'b'.repeat(64)] } });
  changed.select(); await changed.confirm();
  assert.equal(changed.votes.length, 0);
  assert.match(changed.text(changed.render()), /Refund evidence changed/);
});
