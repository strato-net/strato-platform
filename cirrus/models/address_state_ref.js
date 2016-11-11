/* jshint indent: 2 */

module.exports = function(sequelize, DataTypes) {
  return sequelize.define('address_state_ref', {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      //primaryKey: true,
      autoIncrement: true
    },
    address: {
      type: DataTypes.STRING,
      allowNull: false,
      primaryKey: true
    },
    nonce: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    balance: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    contract_root: {
      type: DataTypes.STRING,
      allowNull: false
    },
    code: {
      type: 'BYTEA',
      allowNull: false
    },
    latest_block_data_ref_number: {
      type: DataTypes.STRING,
      allowNull: false
    }
  }, {
    tableName: 'address_state_ref',
    timestamps: false
  });
};
