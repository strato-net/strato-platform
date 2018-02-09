'use strict';

module.exports = function(sequelize, DataTypes) {
  let Stat = sequelize.define('Stat', {
    isConnected: {type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false},
    blockNumber: {type: DataTypes.INTEGER, allowNull: true},
    peerCount: {type: DataTypes.INTEGER, allowNull: true},
  });

  Stat.associate = function(models) {
    Stat.belongsTo(models.Node, {
      onDelete: "CASCADE",
      foreignKey: {
        allowNull: false
      }
    })
  };

  return Stat;
};
