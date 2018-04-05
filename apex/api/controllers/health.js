const BlockDataRef = require('../models/strato/eth/blockDataRef');

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
  }
};
