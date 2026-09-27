const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness({ kind = 'withdrawal_refund', action = 'refund', response, failure, unavailable = false } = {}) {
  const state = []; let cursor = 0;
  const votes = [], requests = [];
  const item = { id: 'eab:withdrawal:2', reference: '2', source: 'eab', kind, chainId: '11155111', account: 'abc', token: 'def', amount: '100', reason: 'Review required', actions: kind === 'withdrawal_review' ? [] : [action], safeProposalHash: kind === 'withdrawal_review' ? 'a'.repeat(64) : undefined };
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  const source = fs.readFileSync(path.join(__dirname, '../src/components/admin/BridgeReviewQueue.tsx'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require: id => {
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (id === 'react') return { useState: initial => { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = value; }]; } };
      if (id === '@tanstack/react-query') return { useQuery: () => ({ data: unavailable ? undefined : [item], isError: unavailable, refetch: async () => {} }) };
      if (id === '@/context/UserContext') return { useUser: () => ({ castVoteOnIssue: async (...args) => votes.push(args) }) };
      if (id === '@/lib/axios') return { api: { post: async (...args) => { requests.push(args); if (failure) throw { response: { data: { error: failure } } }; return { data: response }; } } };
      if (id === '@/lib/bridge/utils') return { getChainName: () => 'Sepolia' };
      if (id === '@/utils/numberUtils') return { truncateAddress: value => value };
      return new Proxy({}, { get: (_, name) => String(name) });
    },
  });
  const render = () => { cursor = 0; return exports.default(); };
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  const text = tree => !tree || typeof tree !== 'object' ? String(tree ?? '') : Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children);
  const select = () => nodes(render()).find(node => node.props?.children === (action === 'settle' ? 'Settle approved deposit' : action === 'reject' ? 'Reject / vote' : 'Prepare refund / vote')).props.onClick();
  const confirm = () => nodes(render()).find(node => node.type === 'Button' && text(node).includes(action === 'settle' ? 'Confirm settlement' : 'Confirm vote')).props.onClick();
  return { select, confirm, render, text, votes, requests };
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

test('deposit rejection explains the lack of external refund; settlement does not cast a vote', async () => {
  const rejection = harness({ kind: 'deposit_review', action: 'reject' });
  rejection.select();
  assert.match(rejection.text(rejection.render()), /does not refund external funds/);
  const settlement = harness({ kind: 'deposit_review', action: 'settle', response: { transactionHash: 'tx' } });
  settlement.select(); await settlement.confirm();
  assert.equal(settlement.votes.length, 0);
  assert.match(settlement.text(settlement.render()), /Deposit settlement submitted/);
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
  assert.doesNotMatch(text, /Reject \/ vote|Prepare refund \/ vote/);
  assert.equal(h.requests.length, 0);
  assert.equal(h.votes.length, 0);
});
