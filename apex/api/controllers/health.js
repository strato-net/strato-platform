const BlockDataRef = require('../models/strato/eth/blockDataRef');
const models = require('../models');

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

      res.status(200).json(
        {
          lastBlock: {
            number: lastBlock.number,
            hash: lastBlock.hash,
            parentHash: lastBlock.parent_hash,
            totalDifficulty: lastBlock.total_difficulty,
            nonce: lastBlock.nonce,
          }
        }
      )
    } catch (error) {
      return next(new Error('could not get data from database: ' + error));
    }
  },

  healthStatus: async function (req, res, next){
    try {
        let uptime, healthStatus, isInc;

        let isNotStalled, isHealthy;
        let failureTimeStalled, failureTimeHealth;
        await models.CurrentHealth.findAll({
            attributes: [
                'processName',
                'latestHealthStatus',
                'latestCheckTimestamp',
                'lastFailureTimestamp',
                'isBlocksValidInc'
            ]}).then(function (data) {
            if (data.length) {
                data.forEach(function (element) {
                    if (element.processName == "HealthStat") {
                        isHealthy = element.latestHealthStatus;
                        failureTimeHealth = element.lastFailureTimestamp;

                    } else if (element.processName == "StallStat") {
                        isNotStalled = element.latestHealthStatus;
                        failureTimeStalled = element.lastFailureTimestamp;
                        isInc = element.isBlocksValidInc;
                    }
                })


            }}).catch(function (err) {
                console.log("getHealthStatus Error:", err);
            });
        const currentTime = Date.now();

        uptime = Math.min(currentTime - failureTimeStalled, currentTime - failureTimeHealth) / 1000;

        healthStatus = isHealthy && isNotStalled;

        res.status(200).json(
            {
                healthInfo: {
                    uptime: uptime,
                    isHealthy: healthStatus,
                    isValidBlocksInc: isInc
                }
            }
        )
    } catch (error) {
        return next(new Error('could not get data from database: ' + error));
    }

  }
};
