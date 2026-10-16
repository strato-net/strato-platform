/* jshint esnext: true */

// Pure stall check logic - needs no database or Prometheus:
//   npx mocha test/stall-check.test.js
const assert = require('chai').assert;
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
});
