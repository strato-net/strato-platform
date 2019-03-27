const BlockDataRef = require('../models/strato/eth/blockDataRef');
const models = require('../models');
const co = require('co');

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

  healthStatus: function (req, res, next){
      co(function* (){
    try {
        let healthStatus, uptime, isInc;

        const healthInfo = yield models.CurrentHealth.findOne({
            where: {
                processName: "HealthStat"
            },
            attributes: [
                'latestHealthStatus',
                'latestCheckTimestamp',
                'lastFailureTimestamp'
            ]}).catch(err => next(err));
        const stallInfo = yield models.CurrentHealth.findOne({
            where: {
                processName: "StallStat"
            },
            attributes: [
                'latestHealthStatus',
                'latestCheckTimestamp',
                'lastFailureTimestamp',
                'isBlocksValidInc'
            ]}).catch(err => next(err));

        const currentTime = Date.now();

        if (healthInfo && stallInfo){
            healthStatus = healthInfo.dataValues.latestHealthStatus && stallInfo.dataValues.latestHealthStatus;
            uptime = (healthStatus) ? currentTime - Math.max(healthInfo.dataValues.lastFailureTimestamp, stallInfo.dataValues.lastFailureTimestamp) : 0;
            isInc = stallInfo.dataValues.isBlocksValidInc	;
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
                    isValidBlocksInc: isInc || false,
                }
            }
        )
    } catch (error) {
        return next(new Error('could not get data from database: ' + error));
    }})

  }
};
