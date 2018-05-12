'use strict';
module.exports = (sequelize, DataTypes) => {
  var EntityUser = sequelize.define('EntityUser', {
    email: {
      type: DataTypes.STRING,
      allowNull: false
    },
    admin: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false
    }
  }, {});
  EntityUser.associate = function (models) {
    EntityUser.belongsTo(models.User);
  };
  return EntityUser;
};