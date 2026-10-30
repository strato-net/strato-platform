const axios = require("axios");
const config = require("../config/app.config");

// The node's live connections, from strato-p2p's own API: the thread view
// that knows every peer the node is in session with, accepted as well as
// dialed. The peer table only ever recorded the dialed ones, so a node that
// mostly gets dialed, a bootnode above all, reported almost no peers.
//
// strato-p2p's API listens next to strato-api, on the fixed port Prometheus
// scrapes its metrics from (10248, STRATO_PORT_P2P_API).

// strato-p2p's label for a connection past its RLPx handshake
// (Blockchain.Threads); the connections in this state are the ones its
// connection limit counts, and the ones /health counts.
const ESTABLISHED = "CONNECTED";

function connectionsUrl() {
  const port = process.env.STRATO_PORT_P2P_API || 10248;
  return `http://${process.env.STRATO_HOSTNAME}:${port}/connections`;
}

// The live connections as [{ host, port, direction, state }]: host is the
// remote IP for an accepted ("inbound") connection, whose listening port is
// unknown (port null), and the address and port dialed for an "outbound"
// one. Throws when strato-p2p is unreachable or answers something else, so
// the caller can fall back.
async function fetchConnections() {
  const { data } = await axios({
    method: "GET",
    url: connectionsUrl(),
    maxRedirects: 0,
    timeout: config.healthCheck.requestTimeout - 100,
  });
  return normalizeConnections(data);
}

function normalizeConnections(data) {
  if (!Array.isArray(data)) {
    throw new Error(`unexpected connection list from strato-p2p: ${JSON.stringify(data)}`);
  }
  return data.map((entry) => {
    const valid =
      entry &&
      typeof entry.host === "string" &&
      (entry.port === null || Number.isInteger(entry.port)) &&
      (entry.direction === "inbound" || entry.direction === "outbound") &&
      typeof entry.state === "string";
    if (!valid) {
      throw new Error(`unexpected connection from strato-p2p: ${JSON.stringify(entry)}`);
    }
    return {
      host: entry.host,
      port: entry.port,
      direction: entry.direction,
      state: entry.state,
    };
  });
}

// How many of the connections are past the handshake.
function countEstablished(connections) {
  return connections.filter((c) => c.state === ESTABLISHED).length;
}

module.exports = {
  ESTABLISHED,
  connectionsUrl,
  fetchConnections,
  normalizeConnections,
  countEstablished,
};
