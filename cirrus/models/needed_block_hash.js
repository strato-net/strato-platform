/* jshint indent: 2 */

module.exports = function(sequelize, DataTypes) {
  return sequelize.define('needed_block_hash', {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true
    },
    hash: {
      type: DataTypes.STRING,
      allowNull: false
    }
  }, {
    tableName: 'needed_block_hash'
  });
};
