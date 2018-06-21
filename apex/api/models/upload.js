'use strict';
module.exports = (sequelize, DataTypes) => {
  var Upload = sequelize.define('Upload', {
    contractAddress: DataTypes.STRING,
    uri: DataTypes.STRING
  }, {
    classMethods: {
      associate: function(models) {
        // associations can be defined here
      }
    }
  });
  return Upload;
};