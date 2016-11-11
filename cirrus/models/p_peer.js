/* jshint indent: 2 */

module.exports = function(sequelize, DataTypes) {
  return sequelize.define('p_peer', {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true
    },
    pubkey: {
      type: DataTypes.STRING,
      allowNull: false
    },
    ip: {
      type: DataTypes.STRING,
      allowNull: false
    },
    port: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    num_sessions: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    last_msg: {
      type: DataTypes.STRING,
      allowNull: false
    },
    last_msg_time: {
      type: DataTypes.DATE,
      allowNull: false
    },
    last_total_difficulty: {
      type: DataTypes.STRING,
      allowNull: false
    },
    last_best_block_hash: {
      type: DataTypes.STRING,
      allowNull: false
    },
    version: {
      type: DataTypes.STRING,
      allowNull: false
    }
  }, {
    tableName: 'p_peer'
  });
};
