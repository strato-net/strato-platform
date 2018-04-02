'use strict';

module.exports = function (sequelize, DataTypes) {
  let Otp = sequelize.define('Otp', {
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    otp: {
      type: DataTypes.STRING
    }
  });

  return Otp;
};