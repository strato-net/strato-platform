const assert = require('node:assert/strict');
const models = require('../models');
const { calcNodeHealthAndSaveVitalStats } = require('../daemons/node-health-check-utils');

describe('Health statistic writes', function () {
  it('waits for statistic writes before completing a check', async function () {
    const original = models.HealthStat.create;
    let finishWrite;
    let completed = false;
    models.HealthStat.create = () => new Promise(resolve => { finishWrite = resolve; });
    try {
      const pending = calcNodeHealthAndSaveVitalStats({ 'core-api': true }).then(() => { completed = true; });
      await new Promise(setImmediate);
      assert.equal(completed, false);
      finishWrite({});
      await pending;
      assert.equal(completed, true);
    } finally {
      models.HealthStat.create = original;
    }
  });

  it('propagates rejected statistic writes to the health-check error handler', async function () {
    const original = models.HealthStat.create;
    models.HealthStat.create = async () => { throw new Error('statistic write failed'); };
    try {
      await assert.rejects(calcNodeHealthAndSaveVitalStats({ 'core-api': true }), /statistic write failed/);
    } finally {
      models.HealthStat.create = original;
    }
  });
});
