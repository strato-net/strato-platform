// The Redis block cache lookup - needs no database, Redis or Prometheus:
//   npx mocha test/redis-block-db.test.js
const assert = require('node:assert/strict');
const redisBlockDB = require('../lib/redis-block-db');

describe('Redis block cache', function () {
  let saved;
  beforeEach(function () { saved = process.env.redis_host; });
  afterEach(function () {
    if (saved === undefined) delete process.env.redis_host;
    else process.env.redis_host = saved;
  });

  it('fails at once where there is no block cache (redis_host=none)', async function () {
    process.env.redis_host = 'none';
    const started = Date.now();
    await assert.rejects(redisBlockDB.getBestBlock(), /redis_host=none/);
    await assert.rejects(redisBlockDB.getValidators(), /redis_host=none/);
    assert.ok(Date.now() - started < 500, 'did not wait for a connect timeout');
  });
});
