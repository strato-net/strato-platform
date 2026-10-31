const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { rest, util, importer } = require('../deploy/strato');
const config = require('../deploy/config');
const { getUserToken } = require('../deploy/auth');

const user = { token: 'test-token' };
let server, baseUrl, options, handler;
let requests = [];

before(async () => {
  server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = {
      method: req.method,
      url: new URL(req.url, baseUrl),
      headers: req.headers,
      body: req.headers['content-type']?.includes('application/json') ? JSON.parse(body) : body,
    };
    requests.push(request);
    res.setHeader('Content-Type', 'application/json');
    try {
      res.end(JSON.stringify(handler(request)));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => {
  requests = [];
  options = { config: { nodes: [{ url: baseUrl }] } };
});

test('async calls preserve transaction payloads, query options and authorization', async () => {
  handler = () => [{ hash: 'tx1', status: 'Pending' }];
  const result = await rest.call(user, {
    contract: { name: 'Token', address: 'abc' }, method: 'transfer',
    args: { to: 'def', amount: '1000000000000000001' },
    value: '2', chainid: '123', txParams: { gasLimit: 5000000 },
  }, {
    ...options, isAsync: true, cacheNonce: true, history: ['Token'],
    query: { username: 'BlockApps' }, headers: { 'X-Test': 'yes' },
    txParams: { gasPrice: 10 },
  });
  assert.deepEqual(result, { hash: 'tx1', status: 'Pending' });
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(request.url.pathname, '/strato/v2.3/transaction/parallel');
  assert.equal(request.url.searchParams.get('username'), 'BlockApps');
  assert.equal(request.url.searchParams.has('resolve'), false);
  assert.equal(request.headers.authorization, 'Bearer test-token');
  assert.equal(request.headers['x-test'], 'yes');
  assert.deepEqual(request.body, {
    txs: [{ type: 'FUNCTION', payload: {
      contractName: 'Token', contractAddress: 'abc', method: 'transfer',
      args: { to: 'def', amount: '1000000000000000001' }, value: '2', chainid: '123',
      txParams: { gasLimit: 5000000 }, metadata: { history: 'Token' },
    } }],
    txParams: { gasLimit: 32100000000, gasPrice: 10 },
  });
});

test('batch calls remain one submission and return all async receipts', async () => {
  const receipts = [{ hash: 'one', status: 'Pending' }, { hash: 'two', status: 'Pending' }];
  handler = () => receipts;
  assert.deepEqual(await rest.callList(user, ['first', 'second'].map((method) => ({
    contract: { name: 'Token', address: 'abc' }, method, args: {},
  })), { ...options, isAsync: true }), receipts);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.txs.length, 2);
  assert.equal(requests[0].url.pathname, '/strato/v2.3/transaction');
});

test('synchronous calls wait for receipts and return function results', async () => {
  let polls = 0;
  handler = (req) => {
    if (req.url.pathname === '/strato/v2.3/transaction') return [{ hash: 'tx', status: 'Pending' }];
    assert.deepEqual(req.body, ['tx']);
    if (++polls === 1) return [{ hash: 'tx', status: 'Pending' }];
    return [{ hash: 'tx', status: 'Success', data: { contents: ['42'] } }];
  };
  assert.deepEqual(await rest.call(user, {
    contract: { name: 'Token', address: 'abc' }, method: 'balance', args: {},
  }, options), ['42']);
  assert.equal(polls, 2);
  assert.equal(requests[0].url.searchParams.get('resolve'), 'true');
  assert.equal(requests[1].url.pathname, '/bloc/v2.2/transactions/results');
  assert.equal(requests[1].url.searchParams.has('resolve'), false);
});

test('resolved transaction failures are rejected instead of reported as successful', async () => {
  handler = (req) => req.url.pathname === '/strato/v2.3/transaction'
    ? [{ hash: 'tx', status: 'Pending' }]
    : [{ hash: 'tx', status: 'Failure', txResult: { message: 'execution reverted' } }];
  await assert.rejects(rest.call(user, {
    contract: { name: 'Token', address: 'abc' }, method: 'transfer', args: {},
  }, options), /execution reverted/);
});

test('detailed function results preserve receipts even without legacy data.contents', async () => {
  const receipt = { hash: 'tx', status: 'Success', data: null, txResult: { response: { v: 'ok' } } };
  handler = () => [receipt];
  assert.deepEqual(await rest.call(user, {
    contract: { name: 'Token', address: 'abc' }, method: 'transfer', args: {},
  }, { ...options, isDetailed: true }), receipt);
});

test('deployments preserve source and metadata and resolve contract addresses', async () => {
  const contract = { name: 'Token', source: [['Token.sol', 'contract Token {}']], args: { owner: 'abc' } };
  handler = (req) => req.url.pathname === '/strato/v2.3/transaction'
    ? [{ hash: 'deploy', status: 'Pending' }]
    : [{ hash: 'deploy', status: 'Success', data: null, txResult: { contractsCreated: ['new-address'] } }];
  assert.deepEqual(await rest.createContract(user, contract, {
    ...options, history: 'Token', enableIndex: false, config: { ...options.config, VM: 'SolidVM' },
  }), { name: 'Token', address: 'new-address' });
  assert.deepEqual(requests[0].body.txs[0], {
    type: 'CONTRACT', payload: {
      contract: 'Token', src: contract.source, args: contract.args,
      metadata: { history: 'Token', noindex: 'Token', VM: 'SolidVM' },
    },
  });
});

test('key, state and Cirrus reads retain their response and filter shapes', async () => {
  handler = () => ({ address: 'abc' });
  assert.equal(await rest.getKey(user, options), 'abc');
  assert.equal(requests[0].url.pathname, '/strato/v2.3/key');
  handler = () => ({ balances: ['12'] });
  assert.deepEqual(await rest.getState(user, { name: 'Token', address: 'abc' }, {
    ...options, chainIds: ['1'], stateQuery: { offset: 5, count: 10 },
  }), { balances: ['12'] });
  assert.equal(requests[1].url.pathname, '/bloc/v2.2/contracts/Token/abc/state');
  assert.equal(requests[1].url.searchParams.get('offset'), '5');
  assert.equal(requests[1].url.searchParams.get('chainid'), '1');
  handler = () => [{ value: '12' }];
  assert.deepEqual(await rest.search(user, { name: 'BlockApps-Token' }, {
    ...options, query: { address: 'eq.abc', 'attributes->>owner': 'eq.def' },
  }), [{ value: '12' }]);
  assert.equal(requests[2].url.pathname, '/cirrus/search/BlockApps-Token');
  assert.equal(requests[2].url.searchParams.get('attributes->>owner'), 'eq.def');
  assert.equal(requests[2].url.searchParams.has('resolve'), false);
});

test('polling propagates errors and times out when its condition is unmet', async () => {
  await assert.rejects(util.until(() => false, async () => [], {}, 1), /timeout/);
  await assert.rejects(util.until(() => false, async () => { throw new Error('unavailable'); }, {}), /unavailable/);
});

test('source bundling preserves import order, deduplication, Windows lines and output formats', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strato-importer-'));
  try {
    fs.writeFileSync(path.join(dir, 'Root.sol'), 'import "Left.sol";\r\nimport "Right.sol";\ncontract Root {}');
    fs.writeFileSync(path.join(dir, 'Left.sol'), 'import "Shared.sol";\ncontract Left {}');
    fs.writeFileSync(path.join(dir, 'Right.sol'), 'import "Shared.sol";\ncontract Right {}');
    fs.writeFileSync(path.join(dir, 'Shared.sol'), 'contract Shared {}');
    const source = await importer.combine(path.join(dir, 'Root.sol'));
    assert.deepEqual(source, [
      ['Shared.sol', 'contract Shared {}\n'],
      ['Left.sol', '//import "Shared.sol";\ncontract Left {}\n'],
      ['Right.sol', '//import "Shared.sol";\ncontract Right {}\n'],
      ['Root.sol', '//import "Left.sol";\r\n//import "Right.sol";\ncontract Root {}\n'],
    ]);
    assert.deepEqual(await importer.combine(path.join(dir, 'Root.sol'), true), Object.fromEntries(source));
    assert.deepEqual(await importer.combine(path.join(dir, 'Root.sol')), source);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('password authentication uses discovery, configured token fields, scope and optional TOTP', async () => {
  const originalNodes = config.nodes;
  const originalScope = process.env.OAUTH_SCOPE;
  const originalTotp = process.env.OAUTH_TOTP;
  try {
    config.nodes = [{ oauth: { openIdDiscoveryUrl: `${baseUrl}/discovery`, clientId: 'client', clientSecret: 'secret', tokenField: 'custom_token' } }];
    process.env.OAUTH_SCOPE = 'openid email';
    delete process.env.OAUTH_TOTP;
    handler = (req) => {
      if (req.url.pathname === '/discovery') return { token_endpoint: `${baseUrl}/token` };
      const form = new URLSearchParams(req.body);
      assert.equal(form.get('grant_type'), 'password');
      assert.equal(form.get('username'), 'user');
      assert.equal(form.get('password'), 'p&ss+word');
      assert.equal(form.get('client_id'), 'client');
      assert.equal(form.get('client_secret'), 'secret');
      assert.equal(form.get('scope'), 'openid email');
      assert.equal(form.get('totp'), process.env.OAUTH_TOTP?.trim() || null);
      return { custom_token: 'access-token' };
    };
    assert.equal(await getUserToken('user', 'p&ss+word'), 'access-token');
    process.env.OAUTH_TOTP = ' 123456 ';
    assert.equal(await getUserToken('user', 'p&ss+word'), 'access-token');
  } finally {
    config.nodes = originalNodes;
    if (originalScope === undefined) delete process.env.OAUTH_SCOPE;
    else process.env.OAUTH_SCOPE = originalScope;
    if (originalTotp === undefined) delete process.env.OAUTH_TOTP;
    else process.env.OAUTH_TOTP = originalTotp;
  }
});
