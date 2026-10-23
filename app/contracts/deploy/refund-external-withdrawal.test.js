const assert = require('node:assert/strict');
const test = require('node:test');
const { prepareRefund, checkRecordedRefundAttestations } = require('./refund-external-withdrawal');

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

test('execute requires the refund attestations the runtime recorded on STRATO for the expected digest', async () => {
  const evidence = { threshold: 2, digest: `0x${'a'.repeat(64)}`,
    authorization: { destinationChainId: '1', sourceBridge: '1'.repeat(40) } };
  let rows = [{ value: 1 }];
  let ok = true;
  const requested = [];
  const options = {
    nodeUrl: 'https://source.example/',
    fetchImpl: async (url, init) => {
      requested.push(url);
      assert.equal(init.headers.Authorization, 'Bearer source-token');
      const query = new URL(url);
      assert.equal(query.origin + query.pathname, 'https://source.example/cirrus/search/BlockApps-ExternalAssetBridge-settlementAttestationCounts');
      assert.equal(query.searchParams.get('address'), `eq.${'1'.repeat(40)}`);
      assert.equal(query.searchParams.get('or'), `(key.eq.${evidence.digest},key.eq.${evidence.digest.slice(2)})`);
      return { ok, status: ok ? 200 : 503, json: async () => rows };
    },
  };
  const check = () => checkRecordedRefundAttestations(evidence, 'source-token', options);
  await assert.rejects(check(), /records 1 of 2 refund attestations.*processing stage withdrawal-refund.*no governance vote submitted/);
  rows = [];
  await assert.rejects(check(), /records 0 of 2 refund attestations/);
  rows = [{ value: 'invalid' }];
  await assert.rejects(check(), /invalid refund attestation count/);
  ok = false;
  await assert.rejects(check(), /query failed: 503/);
  ok = true;
  rows = [{ value: '2' }];
  assert.equal(await check(), 2);
  assert.ok(requested.every((url) => !url.includes('/attest-refund')), 'the tool never calls verifiers');
});
