/* jshint indent: 2 */

module.exports = function(sequelize, DataTypes) {
  return sequelize.define('block_offset', {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true
    },
    offset: {
      type: DataTypes.STRING,
      allowNull: false
    },
    number: {
      type: DataTypes.STRING,
      allowNull: false
    },
    hash: {
      type: DataTypes.STRING,
      allowNull: false
    }
  }, {
    tableName: 'block_offset'
  });
};
