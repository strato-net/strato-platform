/* jshint esnext: true */

// Pure stall check logic - needs no database or Prometheus:
//   npx mocha test/stall-check.test.js
const assert = require('chai').assert;
const http = require('http');
const models = require('../models');
const stallCheckJs = require('../daemons/stall-check-utils');

describe('Tests - Stall check', function () {

  it('reports a stall when Prometheus strings meet the numbers stored in the database', async function () {
    // Prometheus returns sample values as strings, the previous check's
    // counts come back from the StallStat INTEGER column as numbers
    const checkRes = await stallCheckJs.getCurrentHealth(3, '2', 715092, '715092');
    assert.equal(checkRes.stallHealthStatus, false, 'Unhealthy');
    assert.equal(checkRes.validBlocksCountIncreased, false, 'validBlocksIncreased');
    assert.equal(checkRes.hasPendingTxs, true, 'hasPendingTxs');
  });

  it('reports no stall when valid blocks increased, whatever the value types', async function () {
    const checkRes = await stallCheckJs.getCurrentHealth(3, '2', 715092, '715100');
    assert.equal(checkRes.stallHealthStatus, true, 'Healthy');
    assert.equal(checkRes.validBlocksCountIncreased, true, 'validBlocksIncreased');
  });

  it('reports no stall without pending transactions at both checks', async function () {
    assert.equal((await stallCheckJs.getCurrentHealth(0, '2', 715092, '715092')).stallHealthStatus, true);
    assert.equal((await stallCheckJs.getCurrentHealth(3, '0', 715092, '715092')).stallHealthStatus, true);
  });

  it('reports no stall when a count could not be read', async function () {
    const checkRes = await stallCheckJs.getCurrentHealth(3, '2', 715092, undefined);
    assert.equal(checkRes.stallHealthStatus, true, 'Healthy');
    // the previous check failed to read it too (stored as NULL)
    const bothUnread = await stallCheckJs.getCurrentHealth(3, '2', null, undefined);
    assert.equal(bothUnread.stallHealthStatus, true, 'Healthy');
  });

  it('picks the pending series of vm_bagger_txs whatever the order', function () {
    const series = (group, value) => ({
      metric: { __name__: 'vm_bagger_txs', group, job: 'vm-runner' },
      value: [1759762861.4, value],
    });
    const result = [series('queued', '14'), series('seen', '1'), series('pending', '0')];
    assert.equal(stallCheckJs.pendingSeries(result).value[1], '0');
  });

  it('falls back to the only series of a vm-runner without the group label', function () {
    const result = [{ metric: { __name__: 'vm_bagger_txs' }, value: [1759762861.4, '5'] }];
    assert.equal(stallCheckJs.pendingSeries(result).value[1], '5');
  });

  it('converts Prometheus values to counts', function () {
    assert.strictEqual(stallCheckJs.toCount('715092'), 715092);
    assert.strictEqual(stallCheckJs.toCount(715092), 715092);
    assert.strictEqual(stallCheckJs.toCount('0'), 0);
    assert.isUndefined(stallCheckJs.toCount('NaN'));
    assert.isUndefined(stallCheckJs.toCount(''));
    assert.isUndefined(stallCheckJs.toCount(null));
    assert.isUndefined(stallCheckJs.toCount(undefined));
  });

  it('compares with its own previous check, not with the latest row another apex wrote', async function () {
    // Prometheus is a local server and the database calls are stubbed: the
    // latest StallStat rows are another apex instance's, written seconds ago
    // with the same counts.
    const counts = { valid: '715092', pending: '2' };
    const prometheus = http.createServer((req, res) => {
      const query = new URL(req.url, 'http://prometheus').searchParams.get('query');
      const result = query === 'vm_blocks_valid'
        ? [{ metric: {}, value: [Date.now() / 1000, counts.valid] }]
        : [{ metric: { group: 'pending' }, value: [Date.now() / 1000, counts.pending] }];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: 'success', data: { resultType: 'vector', result } }));
    });
    await new Promise((resolve) => prometheus.listen(0, '127.0.0.1', resolve));
    const statuses = [];
    const saved = {
      host: process.env.PROMETHEUS_HOST,
      findOne: models.StallStat.findOne,
      create: models.StallStat.create,
      update: models.CurrentHealth.update,
    };
    process.env.PROMETHEUS_HOST = `127.0.0.1:${prometheus.address().port}`;
    models.StallStat.findOne = async ({ where }) => ({ dataValues: { blockCount: where.blockType === 'Valid' ? 715092 : 2 } });
    models.StallStat.create = async () => ({});
    models.CurrentHealth.update = async (values) => { statuses.push(values.latestHealthStatus); return [1]; };
    try {
      await stallCheckJs.singleCheck(); // this process's first check: nothing to compare with
      await stallCheckJs.singleCheck(); // no new valid block since its previous check: stalled
      counts.valid = '715093';
      await stallCheckJs.singleCheck();
    } finally {
      if (saved.host === undefined) delete process.env.PROMETHEUS_HOST; else process.env.PROMETHEUS_HOST = saved.host;
      models.StallStat.findOne = saved.findOne;
      models.StallStat.create = saved.create;
      models.CurrentHealth.update = saved.update;
      prometheus.close();
    }
    assert.deepEqual(statuses, [true, false, true]);
  });
});
