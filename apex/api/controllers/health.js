const BlockDataRef = require("../models/strato/eth/blockDataRef");
const Peer = require("../models/strato/eth/peer");
const winston = require("winston-color");
const axios = require("axios");
const config = require("../config/app.config");

const utils = require("../lib/utils");
const redisBlockDB = require("../lib/redis-block-db");


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
      const [lastBlock, bestBlockNumber, activePeerCount, validators] = await Promise.all([
        BlockDataRef.findOne({
          where: {
            pow_verified: true,
            is_confirmed: true,
          },
          order: [["number", "DESC"]],
          attributes: [
            "number",
            "hash",
            "parent_hash",
            "nonce",
          ],
          raw: true,
        }),
        // Source `lastBlock.number` from the same place as `strato-barometer syncstats`
        // (used by `bin/strato-ps`): the BestBlock entry in Redis. Falls back to
        // BlockDataRef.number if Redis is unavailable.
        redisBlockDB.getBestBlockNumber().catch((err) => {
          winston.warn(`Falling back to BlockDataRef for lastBlock.number: ${err.message}`);
          return null;
        }),
        // Peers the node is currently connected to: active (active_state=1)
        // and bonded (bond_state=2). Falls back to null so /status remains usable.
        Peer.count({
          where: {
            active_state: 1,
            bond_state: 2,
          },
        }).catch((err) => {
          winston.warn(`Unable to fetch active peers count: ${err.message}`);
          return null;
        }),
        // Current validator list, sourced from the same place as the
        // /eth/v1.2/metadata endpoint: the BestSequencedBlock entry in Redis.
        // Falls back to null so /status remains usable.
        redisBlockDB.getValidators().catch((err) => {
          winston.warn(`Unable to fetch validators: ${err.message}`);
          return null;
        }),
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
        getPbftData(),
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
        validators,
        lastBlock: {
          number: bestBlockNumber !== null ? bestBlockNumber : lastBlock.number,
          hash: lastBlock.hash,
          parentHash: lastBlock.parent_hash,
          nonce: lastBlock.nonce,
        },
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
        bestBlockNumber,
        pbftData,
        nodeAddress,
        activePeerCount,
      ] = await Promise.all([
        utils.getLatestHealth(),
        BlockDataRef.findOne({
          where: {
            pow_verified: true,
            is_confirmed: true,
          },
          order: [["number", "DESC"]],
          attributes: ["number", "hash", "parent_hash", "nonce"],
          raw: true,
        }),
        // Source `lastBlock.number` from the same place as `strato-barometer syncstats`
        // (used by `bin/strato-ps`): the BestBlock entry in Redis. Falls back to
        // BlockDataRef.number if Redis is unavailable.
        redisBlockDB.getBestBlockNumber().catch((err) => {
          winston.warn(`Falling back to BlockDataRef for lastBlock.number: ${err.message}`);
          return null;
        }),
        getPbftData(),
        getNodeAddress(),
        // Peers the node is currently connected to: active (active_state=1)
        // and bonded (bond_state=2). Falls back to null so /health remains usable.
        Peer.count({
          where: {
            active_state: 1,
            bond_state: 2,
          },
        }).catch((err) => {
          winston.warn(`Unable to fetch active peers count: ${err.message}`);
          return null;
        }),
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
        lastBlock: {
          number: bestBlockNumber !== null ? bestBlockNumber : lastBlock.number,
          hash: lastBlock.hash,
          parentHash: lastBlock.parent_hash,
          nonce: lastBlock.nonce,
        },
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
