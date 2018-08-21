const db = require('./connection');

const Block = db.sequelize.define('block_transaction', {
  id: {
    type: db.Sequelize.BIGINT,
    primaryKey: true
  },
  block_data_ref_id: {
    type: db.Sequelize.BIGINT
  },
  transaction: {
    type: db.Sequelize.BIGINT
  }
}, { freezeTableName: true, timestamps: false });

module.exports = Block;
