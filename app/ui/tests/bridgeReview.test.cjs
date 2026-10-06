const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const axiosExports = {};
const bridgeConstants = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/bridge/constants.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: bridgeConstants, require: () => ({ defineChain: value => value }) });
const bridgeUtils = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/bridge/utils.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: bridgeUtils, require: () => bridgeConstants });
const responseInterceptors = [], globalToasts = [];
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/axios.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, {
  exports: axiosExports,
  console: { warn() {} },
  require: id => id === 'axios' ? { default: { create: () => ({ interceptors: { request: { use() {} }, response: { use: (...args) => responseInterceptors.push(args) } } }) } } : id === '@/hooks/use-toast' ? { toast: value => globalToasts.push(value) } : {},
});

function harness({ kind = 'withdrawal_refund', action = 'refund', response, voteResult, failure, status = 409, unavailable = false, stale = false, approved = true, governanceStatus = "available", progress, approvalStatus, refundStatus = 'ready', refundEvidenceHash, overrides = {} } = {}) {
  const state = []; let cursor = 0;
  const votes = [], requests = [];
  const item = { id: 'eab:withdrawal:2', reference: '2', source: 'eab', kind, chainId: '11155111', account: 'abc', token: 'def', amount: '100', reason: 'Review required', actions: kind === 'withdrawal_review' ? [] : [action], safeProposalHash: kind === 'withdrawal_review' ? 'a'.repeat(64) : undefined };
  if (action === 'confirm_refund') { item.source = 'native'; item.recoveryStatus = 'refund_pending'; item.refundEvidenceHash = refundEvidenceHash; }
  item.governanceStatus = governanceStatus;
  item.approvalStatus = approvalStatus;
  item.refundStatus = refundStatus;
  item.governance = { [action]: progress ?? { votesCast: 0, votesRequired: 2, hasVoted: false } };
  if (!approved) item.actions = item.actions.filter(action => action !== 'settle');
  Object.assign(item, overrides);
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  const source = fs.readFileSync(path.join(__dirname, '../src/components/admin/BridgeReviewQueue.tsx'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require: id => {
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (id === 'react') return { useState: initial => { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; } };
      if (id === '@tanstack/react-query') return { useQuery: () => ({ data: unavailable && !stale ? undefined : [item], isError: unavailable, refetch: async () => {} }) };
      if (id === '@/context/UserContext') return { useUser: () => ({ userAddress: 'admin', castVoteOnIssue: async (...args) => {
        votes.push(args);
        return voteResult ?? { status: 'Success', governed: true, issueId: 'issue', hash: 'transaction', message: 'Issue created successfully' };
      } }) };
      if (id === '@/lib/axios') return { extractApiErrorMessage: axiosExports.extractApiErrorMessage, api: { post: async (...args) => { requests.push(args); if (failure) throw { response: { status, data: { error: failure } } }; return { data: response }; } } };
      if (id === '@/lib/bridge/utils') return { ...bridgeUtils, getChainName: () => 'Sepolia' };
      if (id === '@/utils/numberUtils') return { truncateAddress: value => value, formatUnits: require('ethers').formatUnits };
      return new Proxy({}, { get: (_, name) => String(name) });
    },
  });
  const render = () => { cursor = 0; return exports.default(); };
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  const text = tree => !tree || typeof tree !== 'object' ? String(tree ?? '') : Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children);
  const select = () => nodes(render()).find(node => node.props?.children === (action === 'cancel_withdrawal' ? 'Request cancellation / vote' : action === 'confirm_cancellation' ? 'Verify cancellation and refund / vote' : action === 'confirm_refund' ? 'Confirm refund / vote' : action === 'settle' ? 'Settle approved deposit' : action === 'reject' ? 'Reject — no funds received / vote' : action === 'approve' ? kind === 'deposit_recovery' ? 'Complete delivery / vote' : 'Approve deposit / vote' : kind === 'withdrawal_refund' ? 'Refund / vote' : 'Reject and refund / vote')).props.onClick();
  const confirm = () => nodes(render()).find(node => node.type === 'Button' && text(node).includes(action === 'settle' ? 'Confirm settlement' : 'Confirm vote')).props.onClick();
  return { select, confirm, render, text, nodes, votes, requests };
}

test('admin refund UI submits a vote only after successful evidence preparation', async () => {
  const h = harness({ response: { target: 'bridge', func: 'refundWithdrawal', args: ['2'] } });
  h.select();
  assert.equal(h.requests.length, 0, 'opening confirmation must not attest or vote');
  await h.confirm();
  assert.equal(h.requests[0][0], '/bridge/admin/reviews/prepare');
  assert.deepEqual(h.votes, [['bridge', 'refundWithdrawal', ['2'], true]]);
  assert.match(h.text(h.render()), /Governance vote recorded · Issue issue · Transaction transaction/);
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

test('an unrecorded governance transaction is never shown as a submitted vote', async () => {
  const h = harness({
    kind: 'deposit_review',
    action: 'approve',
    response: { target: 'bridge', func: 'approveReviewedDeposit', args: ['11155111', 'router', '2', 'digest'] },
    voteResult: { status: 'Success', governed: false, issueId: null, hash: 'transaction', message: 'No vote was recorded' },
  });
  h.select(); await h.confirm();
  assert.match(h.text(h.render()), /No vote was recorded/);
  assert.doesNotMatch(h.text(h.render()), /Governance vote recorded|Waiting for indexed status/);
});

test('deposit rejection explains the lack of external refund', async () => {
  const rejection = harness({ kind: 'deposit_review', action: 'reject', response: { target: 'bridge', func: 'rejectDepositNoFunds', args: ['11155111', 'router', '2'] } });
  rejection.select();
  assert.match(rejection.text(rejection.render()), /without crediting STRATO assets or issuing a refund/);
  assert.equal(rejection.nodes(rejection.render()).find(node => node.type === 'Button' && rejection.text(node).includes('Confirm vote')).props.disabled, true);
  await rejection.confirm();
  assert.equal(rejection.requests.length, 0);
  rejection.nodes(rejection.render()).find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } });
  await rejection.confirm();
  assert.deepEqual(rejection.votes, [['bridge', 'rejectDepositNoFunds', ['11155111', 'router', '2'], true]]);
});

test('unavailable queue is never presented as an empty healthy queue', () => {
  const h = harness({ unavailable: true });
  assert.match(h.text(h.render()), /review queue is unavailable/);
  assert.doesNotMatch(h.text(h.render()), /No transactions currently require review/);
});

test('STRATO shows withdrawals pending review with approval handled in Safe', () => {
  const h = harness({ kind: 'withdrawal_review' });
  const text = h.text(h.render());
  assert.match(text, /Withdrawal review/);
  assert.match(text, /Safe signers — review and execute the mint proposal/);
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
    assert.match(h.text(tree), refundStatus === 'pending' ? /Verifiers — confirm that no external payment occurred/ : /Admin — refresh after verifier availability is restored/);
    assert.doesNotMatch(h.text(tree), /STRATO admins: remaining votes required|STRATO admin must execute/);
    assert.equal(h.requests.length, 0);
  }
});

test('ready refunds replace the generic rule with the current admin action and destination', () => {
  const h = harness({ overrides: { reason: 'Authorization expired. Refund requires verifier confirmation that no external payment occurred; expiry alone is not proof of non-payment.' } });
  const tree = h.render();
  assert.match(h.text(tree), /STRATO admins — vote to return the escrowed tokens/);
  assert.doesNotMatch(h.text(tree), /Refund requires verifier confirmation|expiry alone/);
  assert.equal(h.nodes(tree).find(node => node.type === 'Button' && h.text(node) === 'Refund / vote').props.disabled, false);
  h.select();
  assert.match(h.text(h.render()), /contract rechecks verifier confirmation/);
});

test('unavailable or stale readiness never tells admins that a refund is ready to vote', () => {
  for (const options of [
    { refundStatus: 'unavailable' }, { overrides: { refundStatus: undefined } },
    { governanceStatus: 'unavailable' }, { overrides: { governance: undefined } },
    { unavailable: true, stale: true },
  ]) {
    const h = harness(options), tree = h.render();
    assert.match(h.text(tree), /Next step:.*Admin — refresh/);
    assert.doesNotMatch(h.text(tree), /Verifier checks complete/);
    assert.equal(h.nodes(tree).find(node => node.type === 'Button' && h.text(node) === 'Refund / vote').props.disabled, true);
  }
});

test('deposit and Safe stages name the next actor without requesting an unnecessary STRATO vote', () => {
  for (const [options, expected] of [
    [{ kind: 'deposit_review', action: 'approve', approvalStatus: 'approved' }, /Bridge service — retry verification and STRATO delivery/],
    [{ kind: 'deposit_recovery', overrides: { actions: [], recoveryStatus: 'reopened' } }, /Bridge service — retry verification and STRATO delivery/],
    [{ kind: 'deposit_recovery', overrides: { actions: [], recoveryStatus: 'refund_pending' } }, /Bridge service — prepare and verify the external refund/],
    [{ kind: 'deposit_recovery', overrides: { actions: [], recoveryStatus: 'refund_pending', source: 'native', safeProposalHash: 'a'.repeat(64) } }, /Safe signers — execute the external refund proposal/],
    [{ kind: 'deposit_recovery', action: 'confirm_refund', refundEvidenceHash: 'a'.repeat(64) }, /STRATO admins — verify the external refund and vote to confirm it/],
    [{ kind: 'withdrawal_review' }, /Safe signers — review and execute the mint proposal/],
    [{ kind: 'withdrawal_review', overrides: { safeProposalHash: undefined } }, /Bridge service — prepare the Safe mint proposal/],
    [{ kind: 'deposit_review', overrides: { actions: [], source: 'legacy' } }, /Bridge service — continue automated processing/],
  ]) {
    const h = harness(options);
    assert.match(h.text(h.render()), expected);
  }
});

test('review actions reflect your vote and quorum without claiming approval', () => {
  const h = harness({ progress: { votesCast: 1, votesRequired: 2, hasVoted: true } });
  const tree = h.render();
  assert.match(h.text(tree), /Refund\s*:.*1.*of.*2.*votes.*You voted/);
  assert.match(h.text(tree), /Next step:.*Other STRATO admins — cast the remaining votes/);
  assert.equal(h.nodes(tree).find(node => node.type === 'Button' && h.text(node) === 'You voted').props.disabled, true);
  const quorum = harness({ progress: { votesCast: 2, votesRequired: 2, hasVoted: true } });
  const ready = quorum.render();
  assert.match(quorum.text(ready), /Quorum reached; STRATO admin must execute/);
  assert.match(quorum.text(ready), /Next step:.*STRATO admin — execute the decision that reached quorum/);
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
  assert.match(h.text(tree), /Next step:.*STRATO indexing/);
  assert.doesNotMatch(h.text(tree), /STRATO admins: remaining votes required/);
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
    assert.match(h.text(h.render()), action === 'approve' ? /Complete delivery/ : /Reject and refund/);
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
  assert.deepEqual(h.votes, [['bridge', response.func, response.args, true]]);
  const changed = harness({ kind: 'deposit_recovery', action: 'confirm_refund', refundEvidenceHash: hash,
    response: { ...response, args: ['2', '0x' + 'b'.repeat(64)] } });
  changed.select(); await changed.confirm();
  assert.equal(changed.votes.length, 0);
  assert.match(changed.text(changed.render()), /Refund evidence changed/);
});

test('native cancellation refund cannot vote with changed external evidence', async () => {
  const hash = 'a'.repeat(64);
  const h = harness({ kind: 'withdrawal_cancellation', action: 'confirm_cancellation',
    overrides: { source: 'native', refundEvidenceHash: hash },
    response: { target: 'bridge', func: 'refundCanceledWithdrawal', args: ['2', 'b'.repeat(64)] } });
  h.select();
  assert.match(h.text(h.render()), /Independently verify the successful NativeMintCanceled/);
  await h.confirm();
  assert.equal(h.votes.length, 0);
  assert.match(h.text(h.render()), /evidence changed/);
});

test('native cancellation refund votes bind to the reviewed external evidence', async () => {
  const hash = 'a'.repeat(64);
  const h = harness({ kind: 'withdrawal_cancellation', action: 'confirm_cancellation',
    overrides: { source: 'native', refundEvidenceHash: hash },
    response: { target: 'bridge', func: 'refundCanceledWithdrawal', args: ['2', hash] } });
  h.select(); await h.confirm();
  assert.deepEqual(h.votes, [['bridge', 'refundCanceledWithdrawal', ['2', hash], true]]);
});
