/* The Redis block cache client where there is no Redis to reach. Needs no
 * database and no Redis: it talks to redis_host=none and to a closed port. */

const assert = require("chai").assert;
const path = require("path");

const MODULE = path.resolve(__dirname, "../lib/redis-block-db.js");

// A fresh copy of the module under the given environment: whether Redis is
// in use and the connect-retry clock live in module state.
function load(env) {
  const saved = {};
  for (const key of ["redis_host", "redis_port", "redis_db_number"]) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  delete require.cache[MODULE];
  const mod = require(MODULE);
  for (const key of Object.keys(saved)) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  return mod;
}

async function rejection(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  assert.fail("expected a rejection");
}

describe("Tests - Redis block cache client", function () {
  it("redis_host=none: every read rejects at once, nothing is connected", async function () {
    const redisBlockDB = load({ redis_host: "none" });
    const reads = [
      () => redisBlockDB.getBestBlock(),
      () => redisBlockDB.getBestBlockNumber(),
      () => redisBlockDB.getValidators(),
      () => redisBlockDB.getSyncStatus(),
      () => redisBlockDB.getParentHash("00"),
    ];
    for (const read of reads) {
      const started = Date.now();
      const err = await rejection(read());
      assert.include(err.message, "redis_host=none");
      assert.isBelow(Date.now() - started, 200, "rejected without waiting on a connect timeout");
    }
  });

  it("redis_host=none is matched case-insensitively and trimmed", async function () {
    const redisBlockDB = load({ redis_host: " NONE " });
    const err = await rejection(redisBlockDB.getBestBlock());
    assert.include(err.message, "redis_host=none");
  });

  it("a failed connect is not retried on every call", async function () {
    this.timeout(10000);
    // Nothing listens on loopback port 1: the connect fails and node-redis
    // retries until the module's timeout gives up on it.
    const redisBlockDB = load({ redis_host: "127.0.0.1", redis_port: "1" });
    const started = Date.now();
    const first = await rejection(redisBlockDB.getBestBlock());
    assert.match(first.message, /timed out|ECONNREFUSED/);
    assert.isAtLeast(Date.now() - started, 1500, "the first call waited for the connect timeout");

    const again = Date.now();
    const second = await rejection(redisBlockDB.getValidators());
    assert.include(second.message, "not retried for another");
    assert.isBelow(Date.now() - again, 200, "the second call rejected at once");
  });
});
