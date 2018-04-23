'use strict';

module.exports = function (sequelize, DataTypes) {
  let tempUser = sequelize.define('TempUser', {
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    password: {
      type: DataTypes.STRING
    },
    verified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false
    }
  }, { freezeTableName: true, timestamps: false });

  return tempUser;
};