const db = require('./connection');

const Block = db.sequelize.define('block', {
  id: {
    type: db.Sequelize.BIGINT,
    primaryKey: true
  },
  block_data: {
    type: db.Sequelize.STRING
  },
  receipt_transactions: {
    type: db.Sequelize.STRING
  },
  block_uncles: {
    type: db.Sequelize.STRING
  }
}, { freezeTableName: true, timestamps: false });

module.exports = Block;
