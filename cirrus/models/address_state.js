/* jshint indent: 2 */

module.exports = function(sequelize, DataTypes) {
  return sequelize.define('address_state', {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true
    },
    nonce: {
      type: 'NUMERIC',
      allowNull: false
    },
    balance: {
      type: 'NUMERIC',
      allowNull: false
    },
    contract_root: {
      type: DataTypes.STRING,
      allowNull: false
    },
    code_hash: {
      type: DataTypes.STRING,
      allowNull: false
    }
  }, {
    tableName: 'address_state'
  });
};
