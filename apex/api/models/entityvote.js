'use strict';
module.exports = (sequelize, DataTypes) => {
  var EntityVote = sequelize.define('EntityVote', {
    agree: {
      type: DataTypes.BOOLEAN,
      allowNull: false
    }
  }, {});
  EntityVote.associate = function(models) {
    EntityVote.belongsTo(models.User);    
    EntityVote.belongsTo(models.EntityUser);    
  };
  return EntityVote;
};