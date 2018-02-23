/* jshint esnext: true */
'use strict';
module.exports = function (sequelize, DataTypes) {
  let User = sequelize.define('User', {
    username: {type: DataTypes.STRING, unique: true, allowNull: false},
    passwordHash: {type: DataTypes.STRING},
    accountAddress: {type: DataTypes.STRING, unique: true}
  });

  User.associate = function(models) {
    User.belongsToMany(models.Role, {through: 'UserRole'});
    // User.hasMany(models.Token)
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
        throw new Error('unknown user id');
      } else {
        return user.Roles.map(roleObj => roleObj.dataValues.name).includes(roleName);
      }
    });
  };

  User.prototype.toJson = function() {
    return {
      id: this.id,
      username: this.username,
      roles: this.Roles.map(role => role.name),
      accountAddress: this.accountAddress
    };
  };

  return User;
};
