'use strict';

module.exports = function (sequelize, DataTypes) {
  let TempUser = sequelize.define('TempUser', {
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
  }, { timestamps: false });

  return TempUser;
};