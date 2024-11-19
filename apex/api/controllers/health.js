const BlockDataRef = require("../models/strato/eth/blockDataRef");
const winston = require("winston-color");
const rp = require("request-promise");
const config = require("../config/app.config");

const utils = require("../lib/utils");


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
      const lastBlock = await BlockDataRef.findOne({
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
      });

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

      const [[healthInfo, stallInfo, systemInfo, syncInfo], pbftData] = await Promise.all([utils.getLatestHealth(), getPbftData()]);

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
        lastBlock: {
          number: lastBlock.number,
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
      let health = null, uptime = null;
      const [healthInfo, stallInfo, systemInfo, syncInfo] =
        await utils.getLatestHealth();

      if (healthInfo && stallInfo && systemInfo && syncInfo) {
        ({ health, uptime } = utils.consolidateHealthData(
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
        health: health,
        uptime: uptime,
      });
    } catch (error) {
      console.error(error);
      return next(new Error("Unable to collect some of the health info."));
    }
  },
};

function getPbftData() {
  if (!process.env["PROMETHEUS_HOST"]) {
    throw Error(
      "PROMETHEUS_HOST env var is not set - unable to get prometheus data"
    );
  }
  const options = {
    method: "GET",
    url: `http://${process.env["PROMETHEUS_HOST"]}/prometheus/api/v1/query?query=pbft_current_view`,
    followRedirects: false,
    timeout: config.healthCheck.requestTimeout - 100,
    json: true,
  };
  return rp(options);
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
