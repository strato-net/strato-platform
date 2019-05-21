const BlockDataRef = require('../models/strato/eth/blockDataRef');
const models = require('../models');
const nodeHealthCheck = require('../daemons/node-health-check')
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

      let healthStatus, stallStatus, uptime, isInc, isPending, healthAI, systemInfoAI, systemInfoStatus;

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
          'isLastPending',
        ],
        raw:true,
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

      const currentTime = Date.now();

      if (healthInfo && stallInfo){
        healthStatus = healthInfo.latestHealthStatus;
        stallStatus = stallInfo.latestHealthStatus;
        uptime = (healthStatus) ? currentTime - healthInfo.lastFailureTimestamp : 0;
        isInc = stallInfo.isBlocksValidInc;
        isPending = stallInfo.isLastPending;
        healthAI = healthInfo.additionalInfo;
        systemInfoAI = systemInfo.additionalInfo;
        systemInfoStatus = systemInfo.latestHealthStatus;
      } else {
        let err = new Error("Not Doing Health Check");
        err.status = 500;
        return next(err);
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
            uptime: uptime/1000,
            isHealthy: healthStatus,
            isNotStalled: stallStatus,
            isValidBlocksInc: isInc || false,
            isLastPending: isPending,
            unhealthyProcess: healthAI
          },
          warning: {
            systemHealth: systemInfoStatus,
            systemInfo: systemInfoAI
          }
        }
      )
    } catch (error) {
      return next(new Error('could not get data from database: ' + error));
    }
  },

  healthStatus: async function (req, res, next){
    try {
        let healthStatus, stallStatus, uptime, isInc, isPending;

        const healthInfo = await models.CurrentHealth.findOne({
            where: {
                processName: "HealthStat"
            },
            attributes: [
                'latestHealthStatus',
                'latestCheckTimestamp',
                'lastFailureTimestamp'
            ]}).catch(err => next(err));
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
            ]}).catch(err => next(err));

        const currentTime = Date.now();

        if (healthInfo && stallInfo){
            healthStatus = healthInfo.dataValues.latestHealthStatus;
            stallStatus = stallInfo.dataValues.latestHealthStatus;
            uptime = (healthStatus) ? currentTime - healthInfo.dataValues.lastFailureTimestamp : 0;
            isInc = stallInfo.dataValues.isBlocksValidInc;
            isPending = stallInfo.dataValues.isLastPending;
        } else {
            let err = new Error("Not Doing Health Check");
            err.status = 500;
            return next(err);
        }

        res.status(200).json(
            {
                healthInfo: {
                    uptime: uptime/1000,
                    isHealthy: healthStatus,
                    isNotStalled: stallStatus,
                    isValidBlocksInc: isInc || false,
                    isLastPending: isPending
                }
            }
        )
    } catch (error) {
        return next(new Error('could not get data from database: ' + error));
    }

  }
};
