'use strict';
module.exports = function (sequelize, DataTypes) {
  let User = sequelize.define('User', {
    username: {type: DataTypes.STRING, allowNull: false, unique: true},
    passwordHash: {type: DataTypes.STRING},
    confirmationToken: {type: DataTypes.STRING},
    isConfirmed: {type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false}
  });

  User.associate = function(models) {
    User.belongsToMany(models.Role, {through: 'UserRole'});
    User.hasMany(models.Node);
  };

  /**
   * Check if user has role by his id
   * @param userId: user id (e.g. from req.user.id)
   * @param roleName: name of the role (e.g. 'admin')
   * return Promise(boolean)
   */
  User.checkRoleById = (userId, roleName) => {
    return User.findById(
      userId,
      {
        include: [{model: sequelize.models.Role}],
      }
    ).then(user => {
      if (!user) {
        throw new Error('unknown user id')
      } else {
        return user.Roles.map(roleObj => roleObj.dataValues.name).includes(roleName);
      }
    })
  };

  User.prototype.toJson = function() {
    return {
      id: this.id,
      username: this.username,
      roles: this['Roles'].map(role => role.name),
    }
  };

  return User;
};