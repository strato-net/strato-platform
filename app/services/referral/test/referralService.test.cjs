const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
const { Wallet, concat, getBytes, keccak256, toUtf8Bytes } = require('ethers');

for (const name of ['BA_USERNAME', 'BA_PASSWORD', 'CLIENT_SECRET', 'CLIENT_ID', 'OPENID_DISCOVERY_URL']) {
  process.env[name] = 'test';
}
process.env.ESCROW_ADDRESS = 'a'.repeat(40);

let queries;
let submissions;
let lookup;
let submit;
const stub = (path, exports) => {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
stub('../src/utils/api.ts', { cirrus: { get: async (path, options) => {
  queries.push({ path, ...options.params });
  return lookup(options.params);
} } });
stub('../src/utils/stratoHelper.ts', { execute: async (input) => {
  submissions.push(input);
  return submit(input);
} });
stub('../src/utils/logger.ts', { logError() {} });
const { redeemReferral } = require('../src/services/referralService.ts');

const wallet = new Wallet('0x' + '11'.repeat(32));
const recipient = 'b'.repeat(40);
const offer = wallet.address.slice(2).toLowerCase();
// Independent fixture using the exact bytes constructed by RecipientClaim.tsx.
const digest = keccak256(concat([
  '0xed97', toUtf8Bytes('STRATO_ESCROW_REDEEM_V1'), '0x94' + recipient,
]));
const { r, s, v } = wallet.signingKey.sign(getBytes(digest));
const request = { recipient, r, s, v };
const deposit = { field: null, sender: 'c'.repeat(40), quantity: '1' };
const offerRows = [deposit, { field: 'tokens', length: '1' }, { field: 'amounts', length: '1' }];
const success = { status: 'Success', hash: 'test-hash' };

beforeEach(() => {
  queries = [];
  submissions = [];
  lookup = async (params) => params.collection_name === 'eq.deposits' ? offerRows : [];
  submit = async () => success;
});

test('valid signature checks the configured escrow and recipient before submitting', async () => {
  assert.deepEqual(await redeemReferral(request), success);
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].args.recipient, recipient);
  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.equal(query.path, '/mapping');
    assert.equal(query.address, 'eq.' + process.env.ESCROW_ADDRESS);
    assert.equal(query['key->>key'], 'eq.' + offer);
  }
  assert.equal(queries[0]['key->>key3'], 'is.null');
  assert.equal(queries[1]['key->>key2'], 'eq.' + recipient);
});

test('prefixed uppercase recipient and recovery id 0/1 use the same offer', async () => {
  await redeemReferral({ ...request, recipient: '0x' + recipient.toUpperCase(), v: v - 27 });
  assert.equal(queries[0]['key->>key'], 'eq.' + offer);
  assert.equal(submissions[0].args.recipient, recipient);
});

test('malformed signatures and addresses never query Cirrus or submit', async () => {
  for (const invalid of [{ r: 'nonsense' }, { s: null }, { v: 29 }, { v: '27' },
    { recipient: '../anything' }, { r: '0x' + '00'.repeat(32) }]) {
    await assert.rejects(redeemReferral({ ...request, ...invalid }));
  }
  assert.equal(queries.length, 0);
  assert.equal(submissions.length, 0);
});

test('missing, exhausted, cancelled and malformed offers never submit', async () => {
  for (const rows of [[], null, [deposit, deposit], [{ ...deposit, quantity: '0' }],
    [{ ...deposit, sender: '0'.repeat(40) }], [{ ...deposit, quantity: '-1' }],
    [{ ...deposit, quantity: 'garbage' }]]) {
    lookup = async (params) => params.collection_name === 'eq.deposits' ? rows : [];
    await assert.rejects(redeemReferral(request));
  }
  assert.equal(submissions.length, 0);
});

test('a signature for another recipient does not authorize this offer', async () => {
  lookup = async (params) => params['key->>key'] === 'eq.' + offer ? offerRows : [];
  await assert.rejects(redeemReferral({ ...request, recipient: 'd'.repeat(40) }));
  assert.equal(submissions.length, 0);
});

test('previous redemption or an unreadable recipient response never submits', async () => {
  for (const rows of [[{ value: true }], [{ value: 'true' }], [{ value: null }], null]) {
    lookup = async (params) => params.collection_name === 'eq.deposits' ? offerRows : rows;
    await assert.rejects(redeemReferral(request));
  }
  assert.equal(submissions.length, 0);
});

test('an explicitly false recipient flag permits redemption', async () => {
  lookup = async (params) => params.collection_name === 'eq.deposits' ? offerRows : [{ value: false }];
  await redeemReferral(request);
  assert.equal(submissions.length, 1);
});

test('Cirrus failure prevents submission and releases the pending offer', async () => {
  lookup = async () => { throw new Error('Cirrus unavailable'); };
  await assert.rejects(redeemReferral(request), /Cirrus unavailable/);
  assert.equal(submissions.length, 0);
  lookup = async (params) => params.collection_name === 'eq.deposits' ? offerRows : [];
  await redeemReferral(request);
  assert.equal(submissions.length, 1);
});

test('duplicate claims are blocked until the submitted transaction finishes', async () => {
  let finish;
  let submitted;
  const started = new Promise(resolve => { submitted = resolve; });
  submit = () => {
    submitted();
    return new Promise(resolve => { finish = resolve; });
  };
  const first = redeemReferral(request);
  await started;
  await assert.rejects(redeemReferral(request), /already pending/);
  assert.equal(submissions.length, 1);
  finish(success);
  await first;
});

test('failed submission releases the pending offer', async () => {
  submit = async () => { throw new Error('submission failed'); };
  await assert.rejects(redeemReferral(request), /submission failed/);
  submit = async () => success;
  await redeemReferral(request);
  assert.equal(submissions.length, 2);
});

test('an empty-token offer cannot make the service pay for a guaranteed failure', async () => {
  for (const rows of [[deposit], [deposit, { field: 'tokens', length: '0' }, offerRows[2]],
    [deposit, offerRows[1], { field: 'amounts', length: '0' }]]) {
    lookup = async (params) => params.collection_name === 'eq.deposits' ? rows : [];
    await assert.rejects(redeemReferral(request));
  }
  assert.equal(submissions.length, 0);
});
