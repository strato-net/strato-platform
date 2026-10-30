const BlockDataRef = require("../models/strato/eth/blockDataRef");
const Peer = require("../models/strato/eth/peer");
const winston = require("winston-color");
const axios = require("axios");
const config = require("../config/app.config");

const utils = require("../lib/utils");
const nodeStatusDB = require("../lib/node-status-db");
const redisBlockDB = require("../lib/redis-block-db");
const p2pPeers = require("../lib/p2p-peers");


const API_VERSION = "2.0";

module.exports = {
  ping: async function (req, res) {
    res.status(200).send("pong");
  },
  getPbftData,
  findView,
  nodeStatus: async function (req, res, next) {
    try {
      //get node's block number, best block hash, best block parent hash
      const [lastBlock, { peers, activePeerCount }, validators] = await Promise.all([
        getLastBlock(),
        getPeers(),
        getValidators(),
      ]);

      //adding an empty body so the fields are present in the response even if
      //the health table doesn't have any records yet
      let healthBody = {
        healthStatus: null,
        healthIssues: null,
        uptime: 0,
        healthData: {
          healthChecks: {
            health: null,
            latestCheckTimestamp: null,
            lastFailureTimestamp: null,
          },
          nodeSync: {
            isSynced: null,
            isSyncStalled: null,
            latestCheckTimestamp: null,
            lastFailureTimestamp: null,
          },
          stallHealth: {
            health: null,
            validBlocksIncreased: null,
            hasPendingTxs: null,
            latestCheckTimestamp: null,
            lastFailureTimestamp: null,
          },
          systemHealth: {
            health: null,
            systemInfo: null,
            warnings: null,
            latestCheckTimestamp: null,
            lastFailureTimestamp: null,
          },
        },
      };

      const [[healthInfo, stallInfo, systemInfo, syncInfo], pbftData, nodeAddress] = await Promise.all([
        utils.getLatestHealth(),
        getPbftDataOrNull(),
        getNodeAddress(),
      ]);

      if (healthInfo && stallInfo && systemInfo && syncInfo) {
        healthBody = utils.consolidateHealthData(
          healthInfo,
          stallInfo,
          systemInfo,
          syncInfo
        );
      } else {
        winston.warn(
          `Health table has no entries; Health endpoint is called too soon`
        );
      }

      res.status(200).json({
        apiVersion: API_VERSION,
        version: process.env.STRATO_VERSION,
        timestamp: new Date().toISOString(),
        nodeAddress,
        activePeerCount,
        peers,
        validators,
        lastBlock,
        pbftData: findView(pbftData),
        ...healthBody,
      });
    } catch (error) {
      console.error(error);
      return next(new Error("Unable to collect some of the health info."));
    }
  },

  healthStatus: async function (req, res, next) {
    try {
      let health = null, uptime = null, healthStatus = null, healthIssues = [], healthData = null;
      const [
        [healthInfo, stallInfo, systemInfo, syncInfo],
        lastBlock,
        pbftData,
        nodeAddress,
        { peers, activePeerCount },
      ] = await Promise.all([
        utils.getLatestHealth(),
        getLastBlock(),
        getPbftDataOrNull(),
        getNodeAddress(),
        getPeers(),
      ]);

      if (healthInfo && stallInfo && systemInfo && syncInfo) {
        ({ health, uptime, healthStatus, healthIssues, healthData } = utils.consolidateHealthData(
          healthInfo,
          stallInfo,
          systemInfo,
          syncInfo
        ));
      } else {
        winston.warn(
          `Health table has no entries; Health endpoint is called too soon`
        );
      }

      res.status(200).json({
        apiVersion: API_VERSION,
        version: process.env.STRATO_VERSION,
        timestamp: new Date().toISOString(),
        nodeAddress,
        activePeerCount,
        peers,
        lastBlock,
        pbftData: findView(pbftData),
        health: health,
        healthStatus: healthStatus,
        healthIssues: healthIssues,
        nodeSync: healthData && healthData.nodeSync,
        stallHealth: healthData && healthData.stallHealth,
        uptime: uptime,
      });
    } catch (error) {
      console.error(error);
      return next(new Error("Unable to collect some of the health info."));
    }
  },
};

// The last block, as { number, hash, parentHash, nonce }. Redis first: the
// block cache strato-indexer keeps for p2p, which is what strato-ps reports
// and all a lite validator has (no SQL block index, no node_status mirror).
// Without a Redis block cache here (an API tier's apex), the block_data_ref
// row with the number the core mirrors into node_status, as before.
const noBlock = { number: null, hash: null, parentHash: null, nonce: null };

async function getLastBlock() {
  try {
    const best = await redisBlockDB.getBestBlock();
    if (best) {
      const parentHash = await redisBlockDB.getParentHash(best.hash).catch(() => null);
      return { number: best.number, hash: best.hash, parentHash, nonce: null };
    }
  } catch (err) {
    winston.debug(`No Redis block cache here, reading the last block from SQL: ${err.message}`);
  }
  try {
    const [row, mirrored] = await Promise.all([
      BlockDataRef.findOne({
        where: {
          pow_verified: true,
          is_confirmed: true,
        },
        order: [["number", "DESC"]],
        attributes: ["number", "hash", "parent_hash", "nonce"],
        raw: true,
      }),
      nodeStatusDB.getBestBlockNumber().catch((err) => {
        winston.warn(`Falling back to BlockDataRef for lastBlock.number: ${err.message}`);
        return null;
      }),
    ]);
    if (!row) return noBlock;
    return {
      number: mirrored !== null ? mirrored : row.number,
      hash: row.hash,
      parentHash: row.parent_hash,
      nonce: row.nonce,
    };
  } catch (err) {
    winston.warn(`Unable to read the last block: ${err.message}`);
    return noBlock;
  }
}

// The current validator list: Redis first, else the node_status mirror, else
// null so /status and /health remain usable.
async function getValidators() {
  try {
    const validators = await redisBlockDB.getValidators();
    if (validators) return validators;
  } catch (err) {
    winston.debug(`No Redis block cache here, reading the validators from node_status: ${err.message}`);
  }
  return nodeStatusDB.getValidators().catch((err) => {
    winston.warn(`Unable to fetch validators: ${err.message}`);
    return null;
  });
}

// The node's live connections from strato-p2p, as { peers, activePeerCount }:
// every peer the node is in session with, accepted or dialed, and how many
// of those are past the handshake (the count strato-p2p's own connection
// limit uses). The peer table knew only the dialed peers: an accepted
// session was recorded under the connection's source port and matched no
// row, so a bootnode showed a handful of peers while most of the network
// was connected to it. The table's count remains the fallback, with peers
// null, when strato-p2p's API cannot be reached (an API tier's apex).
async function getPeers() {
  try {
    const peers = await p2pPeers.fetchConnections();
    return { peers, activePeerCount: p2pPeers.countEstablished(peers) };
  } catch (err) {
    winston.warn(`Unable to fetch the connections from strato-p2p, counting the peer table instead: ${err.message}`);
    return { peers: null, activePeerCount: await countActivePeerRows() };
  }
}

// Peers the peer table has as connected: active (active_state=1) and bonded
// (bond_state=2). Null when the table cannot be read, so /status and /health
// remain usable.
function countActivePeerRows() {
  return Peer.count({
    where: {
      active_state: 1,
      bond_state: 2,
    },
  }).catch((err) => {
    winston.warn(`Unable to fetch active peers count: ${err.message}`);
    return null;
  });
}

// Fetches the node's own blockchain address from Prometheus.
// The address is carried in the `address` label of the `pbft_node_identity`
// metric, which the blockstanbul consensus layer emits once it has resolved
// the node identity (from Vault). Returns null if unavailable so /status
// remains usable.
async function getNodeAddress() {
  try {
    if (!process.env["PROMETHEUS_HOST"]) {
      throw Error(
        "PROMETHEUS_HOST env var is not set - unable to get prometheus data"
      );
    }
    const { data: resp } = await axios({
      method: "GET",
      url: `http://${process.env["PROMETHEUS_HOST"]}/prometheus/api/v1/query?query=pbft_node_identity`,
      maxRedirects: 0,
      timeout: config.healthCheck.requestTimeout - 100,
    });
    return findNodeAddress(resp);
  } catch (err) {
    winston.warn(`Unable to fetch node address: ${err.message}`);
    return null;
  }
}

// Extracts the node address from a Prometheus `pbft_node_identity` query
// response. The address lives in the `address` label; returns it with a 0x
// prefix, or null if not present.
function findNodeAddress(obj) {
  if (!(obj && obj.data && obj.data.result && obj.data.result.length)) {
    return null;
  }
  const elem = obj.data.result.find((e) => e && e.metric && e.metric.address);
  if (!elem) {
    return null;
  }
  return `0x${elem.metric.address}`;
}

// The status and health endpoints keep answering without consensus data: when
// Prometheus is unreachable (an API tier runs apex without one), pbftData is
// empty rather than the whole response failing with a 500. The health daemon
// still calls getPbftData directly and handles its errors itself.
async function getPbftDataOrNull() {
  try {
    return await getPbftData();
  } catch (err) {
    winston.warn(`Unable to fetch pbft data: ${err.message}`);
    return null;
  }
}

function getPbftData() {
  if (!process.env["PROMETHEUS_HOST"]) {
    throw Error(
      "PROMETHEUS_HOST env var is not set - unable to get prometheus data"
    );
  }
  return axios({
    method: "GET",
    url: `http://${process.env["PROMETHEUS_HOST"]}/prometheus/api/v1/query?query=pbft_current_view`,
    maxRedirects: 0,
    timeout: config.healthCheck.requestTimeout - 100,
  }).then((res) => res.data);
}

function findView(obj) {
  if (!(obj && obj.data && obj.data.result)) {
    return {};
  }
  const res = obj.data.result;
  let ret = {};
  res.forEach((elem) => {
    if (elem && elem.metric && elem.value && elem.value.length >= 2) {
      ret[elem.metric.view_field] = elem.value[1];
    }
  });
  if (res.length && res[0].value.length && res[0].value[0]) {
    ret.timestamp = new Date(res[0].value[0] * 1000).toISOString();
  } else {
    ret.timestamp = null;
  }

  return ret;
}
