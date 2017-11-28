const db = require('./connection');

const Transaction = db.sequelize.define('raw_transaction', {
  id: {
    type: db.Sequelize.BIGINT,
    primaryKey: true
  },
  timestamp: {
    type: db.Sequelize.DATE
  },
  from_address: {
    type: db.Sequelize.STRING(64)
  },
  nonce: {
    type: db.Sequelize.BIGINT
  },
  gas_price: {
    type: db.Sequelize.BIGINT
  },
  gas_limit: {
    type: db.Sequelize.BIGINT
  },
  to_address: {
    type: db.Sequelize.STRING(64)
  },
  value: {
    type: db.Sequelize.BIGINT
  },
  code_or_data: {
    type: db.Sequelize.BLOB
  },
  r: {
    type: db.Sequelize.STRING
  },
  s: {
    type: db.Sequelize.STRING
  },
  v: {
    type: db.Sequelize.INTEGER
  },
  block_number: {
    type: db.Sequelize.BIGINT
  },
  tx_hash: {
    type: db.Sequelize.STRING(64)
  },
  origin: {
    type: db.Sequelize.STRING
  }
}, { freezeTableName: true, timestamps: false });

module.exports = Transaction;
