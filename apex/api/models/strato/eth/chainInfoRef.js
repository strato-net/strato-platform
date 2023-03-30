const db = require('./connection');

const ChainInfoRef = db.sequelize.define('chain_info_ref', {
  id: {
    type: db.Sequelize.BIGINT,
    primaryKey: true
  },
  chain_id: {
    type: db.Sequelize.STRING
  },
  chain_label: {
    type: db.Sequelize.STRING
  },
  creation_block: {
    type: db.Sequelize.STRING
  },
  chain_nonce: {
    type: db.Sequelize.STRING
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
}, { freezeTableName: true, timestamps: false });

module.exports = ChainInfoRef;
