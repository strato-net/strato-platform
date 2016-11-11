/* jshint indent: 2 */

module.exports = function(sequelize, DataTypes) {
  return sequelize.define('new_blk', {
    hash: {
      type: DataTypes.STRING,
      allowNull: false,
      primaryKey: true
    },
    block_data: {
      type: DataTypes.STRING,
      allowNull: false
    },
    receipt_transactions: {
      type: DataTypes.STRING,
      allowNull: false
    },
    block_uncles: {
      type: DataTypes.STRING,
      allowNull: false
    }
  }, {
    tableName: 'new_blk'
  });
};
