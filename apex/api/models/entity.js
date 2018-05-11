'use strict';
module.exports = (sequelize, DataTypes) => {
  var Entity = sequelize.define('Entity', {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    enodeUrl: {
      type: DataTypes.STRING,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('Member', 'Pending', 'Removal Requested'),
      allowNull: false,
      defaultValue: 'Pending'
    }
  }, {});
  Entity.associate = function (models) {
    Entity.hasMany(models.EntityUser, { as: 'Users' });
  };
  return Entity;
};