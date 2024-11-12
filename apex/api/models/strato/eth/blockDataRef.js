const db = require('./connection');


// TODO: BIGINT has a precision of 64. But some of these fields actually have a precision of a 1000. 
// Need a better representation. Sequelize does not currently support this.
const BlockDataRef = db.sequelize.define('block_data_ref', {
  id: {
    type: db.Sequelize.BIGINT,
    primaryKey: true
  },
  parent_hash: {
    type: db.Sequelize.STRING
  },
  uncles_hash: {
    type: db.Sequelize.STRING
  },
  coinbase: {
    type: db.Sequelize.STRING
  },
  state_root: {
    type: db.Sequelize.STRING
  },
  transactions_root: {
    type: db.Sequelize.STRING
  },
  receipts_root: {
    type: db.Sequelize.STRING
  },
  difficulty: {
    type: db.Sequelize.BIGINT
  },
  number: {
    type: db.Sequelize.BIGINT
  },
  gas_limit: {
    type: db.Sequelize.BIGINT
  },
  gas_used: {
    type: db.Sequelize.BIGINT
  },
  timestamp: {
    type: db.Sequelize.DATE
  },
  extra_data: {
    type: db.Sequelize.STRING
  },
  nonce: {
    type: db.Sequelize.BIGINT
  },
  mix_hash: {
    type: db.Sequelize.STRING
  },
  block_id: {
    type: db.Sequelize.INTEGER
  },
  hash: {
    type: db.Sequelize.STRING
  },
  pow_verified: {
    type: db.Sequelize.BOOLEAN
  },
  is_confirmed: {
    type: db.Sequelize.BOOLEAN
  },
}, { freezeTableName: true, timestamps: false });

module.exports = BlockDataRef;
