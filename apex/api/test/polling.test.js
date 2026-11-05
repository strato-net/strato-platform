const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPoller(name, overrides) {
  const events = [];
  const warnings = [];
  let poll;
  const dependencies = {
    '../rooms': require('../sockets/rooms'),
    '../eventBroker': {
      emitter: { emit: (...args) => events.push(args) },
      ON_SOCKET_PUBLISH_EVENTS: 'publish',
    },
    '../../config/app.config': { webSockets: { dbPollFrequency: 1000, countPollFrequency: 1000 } },
    '../../models/strato/eth/connection': {
      Sequelize: require('sequelize'),
      sequelize: { fn: require('sequelize').fn, col: require('sequelize').col },
    },
    '../../lib/strato-db-data/block-index': { hasBlockIndex: async () => true },
    underscore: require('underscore'),
    moment: require('moment'),
    'big-integer': require('big-integer'),
    'winston-color': { warn: (message) => warnings.push(message) },
    ...overrides,
  };
  const sandbox = {
    module: { exports: {} },
    require: (name) => {
      assert(Object.hasOwn(dependencies, name), name);
      return dependencies[name];
    },
    setInterval: (callback) => { poll = callback; },
  };
  const source = fs.readFileSync(path.join(__dirname, `../sockets/aggregators/${name}.js`), 'utf8');
  vm.runInNewContext(source, sandbox);
  return { events, warnings, poll: () => poll() };
}

const settle = () => new Promise(setImmediate);

describe('Peer polling during node startup', function () {
  it('survives an absent peer table and publishes peers when it becomes available', async function () {
    let ready = false;
    const peer = { ip: '127.0.0.1', host: 'localhost', tcp_port: 30303, pubkey: 'test' };
    const findAll = async () => {
      if (!ready) throw Object.assign(new Error('relation "p_peer" does not exist'), {
        original: { code: '42P01' },
      });
      return [peer];
    };
    const poller = loadPoller('getPeers', { '../../models/strato/eth/peer': { findAll } });
    await settle();
    assert.equal(poller.events.length, 0);
    assert.equal(poller.warnings.length, 0);

    ready = true;
    poller.poll();
    await settle();
    assert.equal(poller.events.length, 1);
    assert.equal(poller.events[0][0], 'publish');
    assert.equal(poller.events[0][1], require('../sockets/rooms').GET_PEERS);
    assert.equal(poller.events[0][2]['127.0.0.1'], peer);

    poller.poll();
    await settle();
    assert.equal(poller.events.length, 1);
  });

  it('reports other database errors and retries on the next poll', async function () {
    let attempts = 0;
    const findAll = async () => {
      attempts++;
      if (attempts === 1) throw new Error('connection interrupted');
      return [];
    };
    const poller = loadPoller('getPeers', { '../../models/strato/eth/peer': { findAll } });
    await settle();
    assert.equal(poller.warnings.length, 1);
    assert.match(poller.warnings[0], /connection interrupted/);
    poller.poll();
    await settle();
    assert.equal(attempts, 2);
    assert.equal(poller.events.length, 1);
  });
});

describe('SQL index polling', function () {
  for (const [name, model, room] of [
    ['userCount', 'transaction', 'USERS_COUNT'],
    ['contractsCount', 'addressStateRef', 'CONTRACTS_COUNT'],
  ]) {
    it(`${name} skips nodes without an index`, async function () {
      let calls = 0;
      const poller = loadPoller(name, {
        [`../../models/strato/eth/${model}`]: { count: async () => { calls++; } },
        '../../lib/strato-db-data/block-index': { hasBlockIndex: async () => false },
      });
      await settle();
      poller.poll();
      await settle();
      assert.equal(calls, 0);
      assert.equal(poller.events.length, 0);
    });

    it(`${name} recovers after a failed query`, async function () {
      let attempts = 0;
      const poller = loadPoller(name, {
        [`../../models/strato/eth/${model}`]: { count: async () => {
          if (++attempts === 1) throw new Error('index table not ready');
          return 7;
        } },
      });
      await settle();
      assert.match(poller.warnings[0], /index table not ready/);
      poller.poll();
      await settle();
      assert.equal(poller.events.length, 1);
      assert.equal(poller.events[0][1], require('../sockets/rooms')[room]);
      assert.equal(poller.events[0][2], 7);
    });
  }

  for (const failingQuery of ['blocks', 'transaction counts']) {
    it(`block polling recovers after ${failingQuery} fail without needing another block`, async function () {
      let blockQueries = 0;
      let countQueries = 0;
      const poller = loadPoller('getBlocks', {
        '../../models/strato/eth/blockDataRef': { findAll: async () => {
          if (++blockQueries === 1 && failingQuery === 'blocks') throw new Error('block query failed');
          return [{ id: 1, number: '1', difficulty: '1', timestamp: new Date() }];
        } },
        '../../models/strato/eth/blockTransaction': { findAll: async () => {
          if (++countQueries === 1 && failingQuery === 'transaction counts') throw new Error('count query failed');
          return [{ block_data_ref_id: 1, get: () => 2 }];
        } },
      });
      await settle();
      assert.equal(poller.warnings.length, 1);
      poller.poll();
      await settle();
      const { TRANSACTIONS_COUNT, LAST_BLOCK_NUMBER } = require('../sockets/rooms');
      const countEvent = poller.events.find(event => event[1] === TRANSACTIONS_COUNT);
      assert.equal(countEvent[2][0].y, 2);
      assert(poller.events.some(event => event[1] === LAST_BLOCK_NUMBER && event[2] === '1'));
    });
  }
});

describe('Health status polling', function () {
  it('recovers after a failed health query', async function () {
    let attempts = 0;
    const poller = loadPoller('getHealthStatus', {
      '../../models': {},
      '../../lib/promClient': { Prometheus: { Counter: class { inc() {} } } },
      '../../lib/utils': { getLatestHealth: async () => {
        if (++attempts === 1) throw new Error('health database unavailable');
        return [null, null, null, null, {
          latestHealthStatus: true,
          additionalInfo: JSON.stringify({ statusMessage: 'HEALTHY' }),
        }];
      } },
    });
    await settle();
    assert.match(poller.warnings[0], /health database unavailable/);
    poller.poll();
    await settle();
    const event = poller.events.find(event => event[1] === require('../sockets/rooms').GET_NETWORK_HEALTH);
    assert.equal(event[2].status, true);
  });
});

function loadNetworkHealth(findOrCreate) {
  const errors = [];
  const dependencies = {
    'winston-color': { info() {}, error: (message) => errors.push(message) },
    '../models': { CurrentHealth: { findOrCreate } },
    bluebird: require('bluebird'),
    axios: async () => ({ data: { urls: {} } }),
    moment: require('moment'),
    '../config/app.config': { healthCheck: { requestTimeout: 1000 } },
  };
  const sandbox = {
    module: { exports: {} },
    process: { env: { MONITOR_URL: '' } },
    require: (name) => {
      assert(Object.hasOwn(dependencies, name), name);
      return dependencies[name];
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../daemons/network-health-check-utils.js'), 'utf8'), sandbox);
  return { singleCheck: sandbox.module.exports.singleCheck, errors };
}

describe('Network health writes', function () {
  it('waits for the database write before completing a check', async function () {
    let finishWrite;
    let completed = false;
    const health = loadNetworkHealth(() => new Promise(resolve => { finishWrite = resolve; }));
    const pending = health.singleCheck().then(() => { completed = true; });
    await settle();
    assert.equal(completed, false);
    finishWrite([null, true]);
    await pending;
    assert.equal(completed, true);
  });

  it('handles failure of both the status write and its fallback', async function () {
    let attempts = 0;
    const health = loadNetworkHealth(async () => {
      attempts++;
      throw new Error('health write failed');
    });
    await health.singleCheck();
    assert.equal(attempts, 2);
    assert.equal(health.errors.length, 2);
    assert.match(health.errors[1], /Could not store network health status/);
  });
});
