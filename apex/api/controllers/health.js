const BlockDataRef = require("../models/strato/eth/blockDataRef");
const models = require("../models");
const winston = require("winston-color");
const rp = require("request-promise");
const config = require("../config/app.config");
const utils = require("../lib/utils");

const API_VERSION = "1.0";

module.exports = {
  ping: async function (req, res) {
    res.status(200).send("pong");
  },
  getPbftData,
  findView,
  nodeStatus: async function (req, res, next) {
    try {
      //get node's block number, best block hash, best block parent hash, total difficulty
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
          "total_difficulty",
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

      const responses = await Promise.all([getLatestHealth(), getPbftData()]);

      const [[healthInfo, stallInfo, systemInfo, syncInfo], pbftData] =
        responses;

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
        timestamp: +new Date() / 1000,
        lastBlock: {
          number: lastBlock.number,
          hash: lastBlock.hash,
          parentHash: lastBlock.parent_hash,
          totalDifficulty: lastBlock.total_difficulty,
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
      let health = null;
      const [healthInfo, stallInfo, systemInfo, syncInfo] =
        await getLatestHealth();

      if (healthInfo && stallInfo && systemInfo && syncInfo) {
        ({ health } = utils.consolidateHealthData(
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
        timestamp: +new Date() / 1000,
        health: health,
      });
    } catch (error) {
      console.error(error);
      return next(new Error("Unable to collect some of the health info."));
    }
  },
};

async function getLatestHealth() {
  const [healthInfo, stallInfo, systemInfo, syncInfo] = await Promise.all([
    models.CurrentHealth.findOne({
      where: {
        processName: "HealthStat",
      },
      attributes: [
        "latestHealthStatus",
        "latestCheckTimestamp",
        "lastFailureTimestamp",
        "additionalInfo",
      ],
      raw: true,
    }),

    models.CurrentHealth.findOne({
      where: {
        processName: "StallStat",
      },
      attributes: [
        "latestHealthStatus",
        "latestCheckTimestamp",
        "lastFailureTimestamp",
        "validBlocksIncreased",
        "hasPendingTxs",
      ],
      raw: true,
    }),

    models.CurrentHealth.findOne({
      where: {
        processName: "SystemInfoStat",
      },
      attributes: [
        "latestHealthStatus",
        "latestCheckTimestamp",
        "lastFailureTimestamp",
        "additionalInfo",
      ],
      raw: true,
    }),

    models.CurrentHealth.findOne({
      where: {
        processName: "SyncStat",
      },
      attributes: [
        "latestHealthStatus",
        "latestCheckTimestamp",
        "lastFailureTimestamp",
        "additionalInfo",
      ],
      raw: true,
    }),
  ]);

  return [healthInfo, stallInfo, systemInfo, syncInfo];
}

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
  ret.timestamp =
    (res.length && res[0].value.length && res[0].value[0]) || null;
  return ret;
}
