/* jshint esnext: true */

const assert = require('chai').assert;
const p2pPeers = require('../lib/p2p-peers');

// What strato-p2p's GET /connections answers: one entry per peer thread
// group, inbound ones by source address only, outbound ones with the port
// they were dialed at, in the state the thread labels carry.
const sample = [
  { host: '13.219.185.85', port: null, direction: 'inbound', state: 'CONNECTED' },
  { host: 'node.lambdachain.xyz', port: 30303, direction: 'outbound', state: 'CONNECTED' },
  { host: '10.0.0.7', port: 30304, direction: 'outbound', state: 'CONNECTING...' },
  { host: '10.0.0.8', port: null, direction: 'inbound', state: 'HANDSHAKING' },
  { host: '10.0.0.9', port: 30303, direction: 'outbound', state: 'DISCONNECTING: PeerDisconnected' },
];

describe('Tests - strato-p2p connection list', function () {
  it('keeps host, port, direction and state of every connection', function () {
    const connections = p2pPeers.normalizeConnections(sample.map((c) => ({ ...c, extra: 'dropped' })));
    assert.deepEqual(connections, sample);
  });

  it('counts only the connections past the handshake', function () {
    assert.equal(p2pPeers.countEstablished(p2pPeers.normalizeConnections(sample)), 2);
    assert.equal(p2pPeers.countEstablished([]), 0);
  });

  it('rejects an answer that is not a connection list', function () {
    assert.throws(() => p2pPeers.normalizeConnections({ error: 'not found' }), /unexpected connection list/);
    assert.throws(() => p2pPeers.normalizeConnections(['<13.219.185.85/CONNECTED']), /unexpected connection/);
    assert.throws(() => p2pPeers.normalizeConnections([{ host: '10.0.0.1', port: '30303', direction: 'outbound', state: 'CONNECTED' }]), /unexpected connection/);
    assert.throws(() => p2pPeers.normalizeConnections([{ host: '10.0.0.1', port: null, direction: 'sideways', state: 'CONNECTED' }]), /unexpected connection/);
  });

  it('asks strato-p2p on its API port next to strato-api', function () {
    const saved = { host: process.env.STRATO_HOSTNAME, port: process.env.STRATO_PORT_P2P_API };
    try {
      process.env.STRATO_HOSTNAME = '172.17.0.1';
      delete process.env.STRATO_PORT_P2P_API;
      assert.equal(p2pPeers.connectionsUrl(), 'http://172.17.0.1:10248/connections');
      process.env.STRATO_PORT_P2P_API = '20248';
      assert.equal(p2pPeers.connectionsUrl(), 'http://172.17.0.1:20248/connections');
    } finally {
      if (saved.host === undefined) delete process.env.STRATO_HOSTNAME; else process.env.STRATO_HOSTNAME = saved.host;
      if (saved.port === undefined) delete process.env.STRATO_PORT_P2P_API; else process.env.STRATO_PORT_P2P_API = saved.port;
    }
  });
});
