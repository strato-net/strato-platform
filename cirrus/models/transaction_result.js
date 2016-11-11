/* jshint indent: 2 */

module.exports = function(sequelize, DataTypes) {
  return sequelize.define('transaction_result', {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true
    },
    block_hash: {
      type: DataTypes.STRING,
      allowNull: false
    },
    transaction_hash: {
      type: DataTypes.STRING,
      allowNull: false
    },
    message: {
      type: DataTypes.STRING,
      allowNull: false
    },
    response: {
      type: DataTypes.STRING,
      allowNull: false
    },
    trace: {
      type: DataTypes.STRING,
      allowNull: false
    },
    gas_used: {
      type: DataTypes.STRING,
      allowNull: false
    },
    ether_used: {
      type: DataTypes.STRING,
      allowNull: false
    },
    contracts_created: {
      type: DataTypes.STRING,
      allowNull: false
    },
    contracts_deleted: {
      type: DataTypes.STRING,
      allowNull: false
    },
    state_diff: {
      type: DataTypes.STRING,
      allowNull: false
    },
    time: {
      type: DataTypes.DOUBLE,
      allowNull: false
    },
    new_storage: {
      type: DataTypes.STRING,
      allowNull: false
    },
    deleted_storage: {
      type: DataTypes.STRING,
      allowNull: false
    }
  }, {
    tableName: 'transaction_result'
  });
};
