const BlockDataRef = require('../models/strato/eth/blockDataRef');
const models = require('../models');
const winston = require('winston-color');
const rp = require('request-promise');
const config = require('../config/app.config');

module.exports = {
  ping: function (req, res) {
    res.status(200).send('pong');
  },

  nodeStatus: async function (req, res, next) {
    try {
      //get node's block number, best block hash, best block parent hash, total difficulty
      const lastBlock = await BlockDataRef.findOne({
        where: {
          pow_verified: true,
          is_confirmed: true
        },
        order: [['number', 'DESC']],
        attributes: [
          'number',
          'hash',
          'parent_hash',
          'total_difficulty',
          'nonce',
        ],
        raw: true,
      });

      let healthStatus, stallStatus, uptime, isInc, isPending, healthAI, systemInfoAI, systemInfoStatus, warningMessages, systemInfoBody;

      const currentTime = Date.now();

      const responses = await Promise.all([getLatestHealth(), getPbftData()]);

      const [[healthInfo, stallInfo, systemInfo], pbftData] = responses;

      if (healthInfo && stallInfo) {
        healthStatus = healthInfo.latestHealthStatus;
        stallStatus = stallInfo.latestHealthStatus;
        uptime = (healthStatus) ? currentTime - healthInfo.lastFailureTimestamp : 0;
        isInc = stallInfo.isBlocksValidInc;
        isPending = stallInfo.isLastPending;
        healthAI = healthInfo.additionalInfo;
        systemInfoAI = JSON.parse(systemInfo.additionalInfo);
        systemInfoStatus = systemInfo.latestHealthStatus;
        warningMessages = systemInfoStatus ? "" : systemInfoAI.Alerts;
        systemInfoBody = systemInfoAI
        if (systemInfoStatus) {
          delete systemInfoBody.Alerts
        }
      } else {
        winston.warn(`Health table has no entries; Health endpoint is called too soon`)
      }

      res.status(200).json(
        {
          lastBlock: {
            number: lastBlock.number,
            hash: lastBlock.hash,
            parentHash: lastBlock.parent_hash,
            totalDifficulty: lastBlock.total_difficulty,
            nonce: lastBlock.nonce,
          },
          pbftData: findView(pbftData),
          healthInfo: {
            uptime: uptime / 1000,
            isHealthy: healthStatus,
            isNotStalled: stallStatus,
            isValidBlocksInc: isInc,
            isLastPending: isPending,
            unhealthyProcess: healthAI
          },
          warnings: {
            warningsActive: !systemInfoStatus,
            messages: warningMessages
          },
          systemInfo: systemInfoBody,
          version: process.env.STRATO_VERSION
        }
      )
    } catch (error) {
      console.error(error);
      return next(new Error("Unable to collect some of the health info."));
    }
  },

  healthStatus: async function (req, res, next) {
    try {
      let healthStatus, stallStatus, uptime, isInc, isPending;

      const currentTime = Date.now();

      const [healthInfo, stallInfo, _ignored_systemInfo] = await getLatestHealth();

      if (healthInfo && stallInfo) {
        healthStatus = healthInfo.latestHealthStatus;
        stallStatus = stallInfo.latestHealthStatus;
        uptime = (healthStatus) ? currentTime - healthInfo.lastFailureTimestamp : 0;
        isInc = stallInfo.isBlocksValidInc;
        isPending = stallInfo.isLastPending;
      } else {
        winston.warn(`Health table has no entires; Health endpoint is called too soon`)
      }

      res.status(200).json(
          {
            healthInfo: {
              uptime: uptime / 1000,
              isHealthy: healthStatus,
              isNotStalled: stallStatus,
              isValidBlocksInc: isInc ,
              isLastPending: isPending
            },
            version: process.env.STRATO_VERSION
          }
      )
    } catch (error) {
      console.error(error);
      return next(new Error("Unable to collect some of the health info."));
    }

  }
};

async function getLatestHealth() {
  const [healthInfo, stallInfo, systemInfo] = await Promise.all([
      
    models.CurrentHealth.findOne({
      where: {
        processName: "HealthStat"
      },
      attributes: [
        'latestHealthStatus',
        'latestCheckTimestamp',
        'lastFailureTimestamp',
        'additionalInfo'
      ],
      raw:true,
    }),

    models.CurrentHealth.findOne({
      where: {
        processName: "StallStat"
      },
      attributes: [
        'latestHealthStatus',
        'latestCheckTimestamp',
        'lastFailureTimestamp',
        'isBlocksValidInc',
        'isLastPending'
      ],
      raw: true,
    }),

    models.CurrentHealth.findOne({
      where: {
        processName: "SystemInfoStat"
      },
      attributes: [
        'latestHealthStatus',
        'latestCheckTimestamp',
        'lastFailureTimestamp',
        'isBlocksValidInc',
        'isLastPending',
        'additionalInfo'
      ],
      raw:true,
    }),
    
  ])
  
  return [healthInfo, stallInfo, systemInfo]
}

function getPbftData() {
  if (!process.env['prometheusHost']) {
    throw Error('prometheusHost env var is not set - unable to get prometheus data');
  }
  const options = {
    method: 'GET',
    url: `http://${process.env['prometheusHost']}/prometheus/api/v1/query?query=pbft_current_view`,
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
  ret.timestamp = res.length && res[0].value[0];
  return ret;
}
