const db = require('./connection');

const Block = db.sequelize.define('block', {
  id: {
    type: db.Sequelize.INTEGER,
    primaryKey: true
  },
  block_data: {
    type: db.Sequelize.CHAR
  },
  receipt_transactions: {
    type: db.Sequelize.CHAR
  },
  block_uncles: {
    type: db.Sequelize.CHAR
  }
}, { freezeTableName: true, timestamps: false });

module.exports = Block;
