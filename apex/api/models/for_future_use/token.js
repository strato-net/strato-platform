'use strict';

module.exports = function(sequelize, DataTypes) {
  let Token = sequelize.define('Token', {
    token: {type: DataTypes.STRING, allowNull: false},
    name: {type: DataTypes.STRING, allowNull: false, unique: 'uniqueNamePerUser'},
  });

  Token.associate = function(models) {
    Token.belongsTo(models.User, {
      foreignKey: {
        allowNull: false,
        unique: 'uniqueNamePerUser',
      }
    });
  };

  Token.prototype.toJson = function() {
    return {
      id: this.id,
      name: this.name,
    }
  };

  return Token;
};
