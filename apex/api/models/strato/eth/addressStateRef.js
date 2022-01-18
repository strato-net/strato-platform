const db = require('./connection');

const AddressStateRef = db.sequelize.define('address_state_ref', {
  id: {
    type: db.Sequelize.BIGINT,
    primaryKey: true
  },
  address: {
    type: db.Sequelize.TEXT
  },
  nonce: {
    type: db.Sequelize.BIGINT
  },
  balance: {
    type: db.Sequelize.BIGINT
  },
  contract_root: {
    type: db.Sequelize.STRING
  },
  code: {
    type: db.Sequelize.BLOB
  },
  code_hash: {
    type: db.Sequelize.STRING
  },
  contract_name: {
    type: db.Sequelize.STRING
  },
  code_ptr_address: {
    type: db.Sequelize.TEXT
  },
  code_ptr_chain_id: {
    type: db.Sequelize.STRING
  },
  chain_id: {
    type: db.Sequelize.STRING
  },
  latest_block_data_ref_number: {
    type: db.Sequelize.STRING
  },
}, { freezeTableName: true, timestamps: false });

module.exports = AddressStateRef;