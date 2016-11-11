/* jshint indent: 2 */

module.exports = function(sequelize, DataTypes) {
  return sequelize.define('user_n', {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false
    },
    login_pass_hash: {
      type: 'BYTEA',
      allowNull: false
    },
    last_login: {
      type: DataTypes.DATE,
      allowNull: false
    },
    num_logins: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    verified: {
      type: DataTypes.BOOLEAN,
      allowNull: false
    },
    verkey: {
      type: 'BYTEA',
      allowNull: false
    }
  }, {
    tableName: 'user_n'
  });
};
