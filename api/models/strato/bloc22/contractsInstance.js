const db = require('./connection');

const ContractInstance = db.sequelize.define('contracts_instance', {
  id: {
    type: db.Sequelize.INTEGER,
    primaryKey: true
  },
  contract_metadata_id: {
    type: db.Sequelize.INTEGER
  },
  address: {
    type: db.Sequelize.STRING
  },
  timestamp: {
    type: db.Sequelize.DATE
  },
}, { freezeTableName: true, timestamps: false });

module.exports = ContractInstance;