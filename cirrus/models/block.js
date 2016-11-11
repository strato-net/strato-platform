/* jshint indent: 2 */

module.exports = function(sequelize, DataTypes) {
  return sequelize.define('block', {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true
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
    tableName: 'block'
  });
};
