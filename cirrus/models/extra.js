/* jshint indent: 2 */

module.exports = function(sequelize, DataTypes) {
  return sequelize.define('extra', {
    the_key: {
      type: DataTypes.STRING,
      allowNull: false,
      primaryKey: true
    },
    value: {
      type: DataTypes.STRING,
      allowNull: false
    }
  }, {
    tableName: 'extra'
  });
};
