/* jshint indent: 2 */

module.exports = function(sequelize, DataTypes) {
  return sequelize.define('log_d_b', {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true
    },
    transaction_hash: {
      type: DataTypes.STRING,
      allowNull: false
    },
    address: {
      type: DataTypes.STRING,
      allowNull: false
    },
    topic1: {
      type: DataTypes.STRING,
      allowNull: true
    },
    topic2: {
      type: DataTypes.STRING,
      allowNull: true
    },
    topic3: {
      type: DataTypes.STRING,
      allowNull: true
    },
    topic4: {
      type: DataTypes.STRING,
      allowNull: true
    },
    the_data: {
      type: 'BYTEA',
      allowNull: false
    },
    bloom: {
      type: DataTypes.STRING,
      allowNull: false
    }
  }, {
    tableName: 'log_d_b'
  });
};
