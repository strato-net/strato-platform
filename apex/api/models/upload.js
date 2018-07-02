'use strict';
module.exports = (sequelize, DataTypes) => {
  var Upload = sequelize.define('Upload', {
    contractAddress: DataTypes.STRING,
    uri: DataTypes.STRING,
    hash: DataTypes.STRING
  }, {
    classMethods: {
      associate: function(models) {
        // associations can be defined here
      }
    }
  });
  return Upload;
};