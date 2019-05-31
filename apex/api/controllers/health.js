const BlockDataRef = require('../models/strato/eth/blockDataRef');
const models = require('../models');
const winston = require('winston-color');
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

      const [healthInfo, stallInfo, systemInfo] = await getLatestHealth();
      if (healthInfo && stallInfo) {
        healthStatus = healthInfo.latestHealthStatus;
        stallStatus = stallInfo.latestHealthStatus;
        uptime = (healthStatus) ? currentTime - healthInfo.lastFailureTimestamp : 0;
        isInc = stallInfo.isBlocksValidInc;
        isPending = stallInfo.isLastPending;
        healthAI = healthInfo.additionalInfo;
        systemInfoAI = systemInfo.additionalInfo;
        systemInfoStatus = systemInfo.latestHealthStatus;
        warningMessages = systemInfoAI.split('"Alerts":')[1].split('}')[0];
        systemInfoBody = systemInfoAI.split('"Alerts":')[0] + '}"'

      } else {
        winston.warn(`Health table has no entires; Health endpoint is called too soon`)
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
          systemInfo: systemInfoBody
        }
      )
    } catch (error) {
      return next(new Error('could not get data from database: ' + error));
    }
  },

  healthStatus: async function (req, res, next) {
    try {
      let healthStatus, stallStatus, uptime, isInc, isPending;


      const currentTime = Date.now();

      const [healthInfo, stallInfo] = await getLatestHealth();

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
            }
          }
      )
    } catch (error) {
      return next(new Error('could not get data from database: ' + error));
    }

  }
};

async function getLatestHealth() {

  const healthInfo = await models.CurrentHealth.findOne({
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
  }).catch(err => next(err));

  const stallInfo = await models.CurrentHealth.findOne({
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
  }).catch(err => next(err));

  const systemInfo = await models.CurrentHealth.findOne({
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
  }).catch(err => next(err));

  return [healthInfo, stallInfo, systemInfo]
}
