const assert = require('node:assert/strict');
const test = require('node:test');
const { prepareRefund, collectRefundAttestations } = require('./refund-external-withdrawal');

test('refund preflight checks confirmed state at the original vault and pins both networks', async () => {
  const bridge = '1'.repeat(40);
  const vaultAddress = '2'.repeat(40);
  const withdrawal = {
    stratoSender: "5".repeat(40), stratoToken: "6".repeat(40), stratoTokenAmount: "100",
    status: 5, externalChainId: '1', externalToken: '3'.repeat(40),
    externalRecipient: '4'.repeat(40), externalTokenAmount: '100', authorizationDeadline: '1100',
  };
  const stored = { notBefore: '1000', deadline: '1100', signerSetVersion: '1', destinationVault: vaultAddress };
  let sourceId = '123456789012345678901234';
  let externalId = '0x1';
  let timestamp = 1101;
  let reservationStatus = 3;
  let digest = 'digest';
  const options = {
    nodeUrl: 'https://strato.invalid', sourceChainId: sourceId, confirmations: 5,
    fetchImpl: async (url) => {
      let body;
      if (url.includes('-withdrawals?')) body = [{ value: withdrawal }];
      else if (url.includes('-withdrawalAuthorizations?')) body = [{ value: stored }];
      else if (url.includes('/metadata?')) body = { networkID: sourceId };
      else body = [{ settlementVerifierThreshold: 2, settlementVerifierSetVersion: "3" }];
      return { ok: true, json: async () => body };
    },
    provider: {
      send: async () => externalId,
      getBlock: async (tag) => tag === 'latest' ? { number: 20, timestamp: 1200 }
        : { number: 15, timestamp, hash: 'confirmed-block' },
    },
    vault: {
      getReservationId: async () => 'reservation',
      reservations: async (_id, { blockTag }) => {
        assert.equal(blockTag, 15);
        return { status: reservationStatus, authorizationDigest: digest };
      },
      authorizationDigest: async (authorization) => {
        assert.equal(authorization.destinationVault, `0x${vaultAddress}`);
        return 'digest';
      },
    },
  };
  const check = () => prepareRefund(bridge, '7', 'auth-token', options);
  assert.equal((await check()).externalBlockNumber, 15);
  for (reservationStatus of [1, 2]) await assert.rejects(check(), /reserved or already released/);
  reservationStatus = 3;
  digest = 'wrong';
  await assert.rejects(check(), /authorization mismatch/);
  digest = 'digest';
  timestamp = 1100;
  await assert.rejects(check(), /has not expired/);
  timestamp = 1101;
  externalId = '0x2';
  await assert.rejects(check(), /External RPC chain ID mismatch/);
  externalId = '0x1';
  sourceId = '123456789012345678901235';
  await assert.rejects(check(), /SOURCE_CHAIN_ID must match/);
  sourceId = options.sourceChainId;
  withdrawal.status = 3;
  reservationStatus = 0;
  assert.equal((await check()).reservationStatus, 0);
  withdrawal.reservationId = '0xaaaa';
  assert.equal((await check()).reservationStatus, 0);
  withdrawal.status = 4;
  await assert.rejects(check(), /not eligible/);
});

test('refund quorum requires the expected digest and indexed on-chain attestations', async () => {
  const names = ['NODE_URL', 'CHAIN_1_EXTERNAL_BRIDGE_VERIFIER_URLS', 'CHAIN_1_EXTERNAL_BRIDGE_VERIFIER_API_TOKENS'];
  const previous = names.map((name) => process.env[name]);
  const originalFetch = global.fetch;
  process.env.NODE_URL = 'https://source.example';
  process.env.CHAIN_1_EXTERNAL_BRIDGE_VERIFIER_URLS = 'https://one.example,https://two.example';
  process.env.CHAIN_1_EXTERNAL_BRIDGE_VERIFIER_API_TOKENS = 'one,two';
  const evidence = { threshold: 2, digest: `0x${'a'.repeat(64)}`,
    authorization: { destinationChainId: '1', sourceBridge: '1'.repeat(40) } };
  let count = 1;
  let responseDigest = evidence.digest;
  global.fetch = async (url) => {
    if (url.includes('/attest-refund')) return { ok: true, json: async () => ({
      digest: responseDigest, transactionHash: 'recorded-tx', settlementAttestor: url.includes('one.') ? 'one' : 'two',
    }) };
    assert.equal(new URL(url).searchParams.get('or'), `(key.eq.${evidence.digest},key.eq.${evidence.digest.slice(2)})`);
    return { ok: true, json: async () => [{ value: count }] };
  };
  try {
    await assert.rejects(collectRefundAttestations(evidence, 'source-token'), /not recorded on chain/);
    count = 'invalid';
    await assert.rejects(collectRefundAttestations(evidence, 'source-token'), /not recorded on chain/);
    count = 2;
    await collectRefundAttestations(evidence, 'source-token');
    responseDigest = `0x${'b'.repeat(64)}`;
    await assert.rejects(collectRefundAttestations(evidence, 'source-token'), /expected source digest/);
  } finally {
    global.fetch = originalFetch;
    names.forEach((name, i) => previous[i] === undefined ? delete process.env[name] : process.env[name] = previous[i]);
  }
});
