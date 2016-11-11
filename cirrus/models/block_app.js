/* jshint indent: 2 */

module.exports = function(sequelize, DataTypes) {
  return sequelize.define('block_app', {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    developer_name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    developer_email: {
      type: DataTypes.STRING,
      allowNull: false
    },
    app_url: {
      type: DataTypes.STRING,
      allowNull: false
    },
    repo_url: {
      type: DataTypes.STRING,
      allowNull: true
    },
    login_pass_hash: {
      type: 'BYTEA',
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
    tableName: 'block_app'
  });
};
