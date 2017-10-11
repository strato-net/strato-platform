'use strict';

module.exports = function(sequelize, DataTypes) {
  let Node = sequelize.define('Node', {
    host: {type: DataTypes.STRING, allowNull: false},
  });

  Node.associate = function(models) {
    Node.hasMany(models.Stat);
  };

  return Node;
};
