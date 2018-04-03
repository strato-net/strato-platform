'use strict';

module.exports = function (sequelize, DataTypes) {
  let tempUser = sequelize.define('temp_user', {
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    password: {
      type: DataTypes.STRING
    }
  }, { freezeTableName: true, timestamps: false });

  return tempUser;
};