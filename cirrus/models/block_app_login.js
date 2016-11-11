/* jshint indent: 2 */

module.exports = function(sequelize, DataTypes) {
  return sequelize.define('block_app_login', {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true
    },
    user_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: {
        model: 'user_n',
        key: 'id'
      }
    },
    block_app_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: {
        model: 'block_app',
        key: 'id'
      }
    },
    timestamp: {
      type: DataTypes.DATE,
      allowNull: false
    },
    ip: {
      type: DataTypes.STRING,
      allowNull: false
    }
  }, {
    tableName: 'block_app_login'
  });
};
