/* jshint indent: 2 */

module.exports = function(sequelize, DataTypes) {
  return sequelize.define('block_transaction', {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true
    },
    block_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: {
        model: 'block',
        key: 'id'
      }
    },
    transaction: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: {
        model: 'raw_transaction',
        key: 'id'
      }
    }
  }, {
    tableName: 'block_transaction'
  });
};
